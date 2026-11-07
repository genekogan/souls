import test from 'node:test';import assert from 'node:assert/strict';
import {matchingMe,authIdentity} from './auth-projection.ts';
import type {Me} from '@souls/protocol';
import {configuredSignIn} from './auth-ui.ts';
test('Clerk-only bootstrap enables shared Sign in, Account and Sign out chrome without a Privy app',()=>{
 assert.equal(configuredSignIn({authProvider:'clerk',privyAppId:'',clerkPublishableKey:'pk_live_fixture',clerkIssuer:'https://clerk.example.test'}),true);
 assert.equal(configuredSignIn({authProvider:'clerk',privyAppId:'legacy-only'}),false);
 assert.equal(configuredSignIn({authProvider:'none',privyAppId:'legacy-unused'}),false);
 assert.equal(configuredSignIn({privyAppId:'legacy-app'}),true);
});
test('Clerk subject pins current internal account projection and rejects another account or late subject',()=>{
 const identity='acct_opaque';
 const me:Me={userId:'acct_opaque',short:'Alice',email:null,wallet:null,role:'user',souls:['s_one'],invited:true};
 assert.equal(matchingMe(true,identity,me),me);assert.equal(matchingMe(false,identity,me),null);assert.equal(matchingMe(true,'acct_other',me),null);
 assert.equal(matchingMe(true,identity,{...me,userId:'acct_other'}),null);
 assert.equal(authIdentity({ready:true,authed:true,label:'display@example.test',login(){},logout(){},async getToken(){return null;},debug:{privyUserId:null,accountIdentity:identity,wallet:null,linked:[]}}),identity);
});
