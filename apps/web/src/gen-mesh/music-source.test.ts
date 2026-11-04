import test from 'node:test';
import assert from 'node:assert/strict';
import { useFileMusic } from './music-source.ts';

test('loopback pages use the synthesised playlist before attempting the inaccessible audio CDN', () => {
  for (const url of ['http://localhost:9960/', 'http://localhost.:9960/', 'http://127.0.0.1:9950/', 'http://127.1/', 'http://127.22.33.44/', 'http://[::1]:9960/', 'http://[0:0:0:0:0:0:0:1]/']) {
    const { hostname, search } = new URL(url); assert.equal(useFileMusic(hostname, search), false, url);
  }
  assert.equal(useFileMusic('::1'), false);
});
test('a valid explicit musicAudio base keeps the existing local FilePlayer proof path', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const audio of ['http://127.0.0.1:5213', 'http://localhost:5213/files/', 'https://proof.example/audio/']) assert.equal(useFileMusic(host, '?musicAudio=' + encodeURIComponent(audio)), true);
    for (const search of ['', '?musicAudio=', '?musicAudio=not-a-url', '?musicAudio=ftp://localhost/']) assert.equal(useFileMusic(host, search), false);
  }
});
test('public origins keep default CDN files without a production-domain allowlist', () => {
  for (const host of ['soul.game', 'example.com', 'preview.example.net', 'localhost.example.com', '127.0.0.1.example.com', '[2001:db8::1]', '192.168.1.8', '']) {
    assert.equal(useFileMusic(host), true, host); assert.equal(useFileMusic(host, '?musicAudio=not-a-url'), true, host);
  }
});
