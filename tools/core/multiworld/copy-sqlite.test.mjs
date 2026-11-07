import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {copySqliteReadOnly} from './copy-sqlite.mjs';

const all=(db,sql)=>{const st=db.prepare(sql);st.setReadBigInts(true);return st.all();};
function fixture(path){
  const w=new DatabaseSync(path);
  w.exec(`PRAGMA journal_mode=WAL; PRAGMA user_version=7; PRAGMA application_id=4242;
   CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT);
   CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, body BLOB, big INTEGER);
   CREATE TABLE named(k TEXT PRIMARY KEY, v REAL);
   CREATE TABLE wr(a TEXT, b INTEGER, c TEXT, PRIMARY KEY(a,b)) WITHOUT ROWID;
   CREATE TABLE usage(n INTEGER);
   CREATE TABLE take_chunks (world_id TEXT NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(world_id, to_tick));
   CREATE INDEX take_chunks_from ON take_chunks(world_id, from_tick);
   CREATE TABLE take_archives(world_id TEXT NOT NULL, segment INTEGER NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL, key TEXT NOT NULL, sha TEXT NOT NULL, bytes INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world_id,segment));
   CREATE INDEX named_v ON named(v);
   INSERT INTO usage VALUES(0);
   CREATE TRIGGER events_count AFTER INSERT ON events BEGIN UPDATE usage SET n=n+1; END;
   INSERT INTO fixture VALUES(1,'before'),(2,'committed-wal');
   INSERT INTO events(body,big) VALUES(x'00ff10',9007199254740993),(NULL,-1),(x'',0);
   DELETE FROM events WHERE seq=2;
   INSERT INTO named VALUES('b',2.5),('a',1.25); DELETE FROM named WHERE k='b'; INSERT INTO named VALUES('c',3);
   INSERT INTO wr VALUES('x',2,'two'),('x',1,'one');
   INSERT INTO take_chunks VALUES('w',0,10,x'0102'),('w',10,20,x'0304');
   INSERT INTO take_archives VALUES('w',1,0,20,'k','s',2,0);`);
  return w;
}
const live=['fixture','events','named','wr','usage','sqlite_sequence'];

test('compact copy: live rows exact (WAL, rowids, blobs, bigints, WITHOUT ROWID), recordings dropped, triggers last, refuses overwrite',()=>{
  const dir=mkdtempSync(join(tmpdir(),'souls-ro-copy-')),source=join(dir,'source.db'),target=join(dir,'copy.db');let w,copy;
  try{
    w=fixture(source);
    const before=Object.fromEntries(live.map(t=>[t,all(w,`SELECT * FROM ${t} ORDER BY 1`)]));
    const rowids=all(w,'SELECT rowid,k FROM named ORDER BY rowid');
    const report=copySqliteReadOnly(source,target);
    assert.deepEqual(report.dropped,{take_chunks:{rows:2,maxToTick:20},take_archives:{rows:1,maxToTick:null}});
    assert.equal(report.tables.events,2);assert.equal(existsSync(`${target}.part`),false);
    copy=new DatabaseSync(target,{readOnly:true});
    for(const t of live)assert.deepEqual(all(copy,`SELECT * FROM ${t} ORDER BY 1`),before[t],t);
    assert.deepEqual(all(copy,'SELECT rowid,k FROM named ORDER BY rowid'),rowids);
    assert.equal(all(copy,'SELECT big FROM events WHERE seq=1')[0].big,9007199254740993n);
    assert.equal(all(copy,'SELECT n FROM usage')[0].n,3n,'trigger did not fire during the copy');
    assert.equal(all(copy,'SELECT count(*) n FROM take_chunks')[0].n,0n);assert.equal(all(copy,'SELECT count(*) n FROM take_archives')[0].n,0n);
    const schema=db=>all(db,"SELECT type,name,sql FROM sqlite_master ORDER BY type,name");
    assert.deepEqual(schema(copy),schema(w));
    for(const p of ['user_version','application_id','page_size'])assert.equal(copy.prepare(`PRAGMA ${p}`).get()[p],w.prepare(`PRAGMA ${p}`).get()[p],p);
    copy.close();copy=new DatabaseSync(target);copy.exec("INSERT INTO events(body) VALUES(x'01')");
    assert.equal(all(copy,'SELECT n FROM usage')[0].n,4n,'trigger works after the copy');
    assert.equal(all(copy,'SELECT max(seq) s FROM events')[0].s,4n,'AUTOINCREMENT continues past the deleted maximum');
    for(const t of live)assert.deepEqual(all(w,`SELECT * FROM ${t} ORDER BY 1`),before[t],`source ${t} unchanged`);
    assert.equal(all(w,'SELECT count(*) n FROM take_chunks')[0].n,2n);
    assert.throws(()=>copySqliteReadOnly(source,target),/fresh separate destination/);assert.throws(()=>copySqliteReadOnly(source,source),/fresh separate destination/);
    const kept=copySqliteReadOnly(source,join(dir,'kept.db'),{keepTakes:true});
    assert.deepEqual(kept.dropped,{});assert.equal(kept.tables.take_chunks,2);
  }finally{copy?.close();w?.close();rmSync(dir,{recursive:true,force:true});}
});

test('compact copy refuses views and leaves no partial destination',()=>{
  const dir=mkdtempSync(join(tmpdir(),'souls-ro-copy-')),source=join(dir,'s.db'),target=join(dir,'t.db');let w;
  try{
    w=new DatabaseSync(source);w.exec('CREATE TABLE a(x); CREATE VIEW v AS SELECT x FROM a;');
    assert.throws(()=>copySqliteReadOnly(source,target),/unsupported schema objects: v/);
    assert.equal(existsSync(target),false);assert.equal(existsSync(`${target}.part`),false);
  }finally{w?.close();rmSync(dir,{recursive:true,force:true});}
});
