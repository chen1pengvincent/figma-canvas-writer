// Conformance checks against the actual offline IIFE shipped in plugin/ui.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';

const html = fs.readFileSync(new URL('../plugin/ui.html', import.meta.url), 'utf8');
const block = html.match(/<!-- FCW_CRYPTO_BEGIN -->([\s\S]*?)<!-- FCW_CRYPTO_END -->/);
assert(block, 'Generated offline crypto block must exist');
assert(!/<script[^>]+src=/i.test(block[1]), 'The shipped crypto must not load remote scripts');
const source = Array.from(block[1].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).join('\n');
const sandbox = { window: {}, Uint8Array, TextEncoder, isSecureContext: false };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = sandbox.window.FCWCrypto;
const utf8 = text => new TextEncoder().encode(text);
const digest = (key, data) => {
  const result = api.hmacSha256(key, data);
  assert(result instanceof Uint8Array);
  assert.equal(result.length, 32);
  return Buffer.from(result).toString('hex');
};

test('actual noble IIFE HMAC-SHA256 matches RFC 4231 cases 1, 2, 3, 4 and 6 and independent Node crypto', () => {
  // Published reference vectors: https://www.rfc-editor.org/rfc/rfc4231
  const vectors = [
    { key: new Uint8Array(20).fill(0x0b), data: utf8('Hi There'), expected: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7' },
    { key: utf8('Jefe'), data: utf8('what do ya want for nothing?'), expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' },
    { key: new Uint8Array(20).fill(0xaa), data: new Uint8Array(50).fill(0xdd), expected: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe' },
    { key: Uint8Array.from({ length: 25 }, (_, i) => i + 1), data: new Uint8Array(50).fill(0xcd), expected: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b' },
    { key: new Uint8Array(131).fill(0xaa), data: utf8('Test Using Larger Than Block-Size Key - Hash Key First'), expected: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54' },
  ];
  for (const v of vectors) {
    const beforeKey = Uint8Array.from(v.key), beforeData = Uint8Array.from(v.data);
    assert.equal(digest(v.key, v.data), v.expected);
    assert.equal(createHmac('sha256', v.key).update(v.data).digest('hex'), v.expected);
    assert.deepEqual(v.key, beforeKey, 'Caller key bytes must remain intact');
    assert.deepEqual(v.data, beforeData, 'Caller message bytes must remain intact');
  }
});

test('actual offline HMAC matches Node UTF-8 bytes for Unicode, empty input and a multi-block Figma-sized message', () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  for (const message of [
    '',
    '🧪 中文画布 / e\u0301 / é / 日本語 / \u0000 / 孤立代理项\ud800',
    JSON.stringify({ sessionId: 'session-测试', pageName: '设计🚀', data: ['透明度', 0.25, null, { '图层名': '第一层\n第二层' }] }),
    '中文字形与emoji😀'.repeat(20000),
  ]) {
    assert.equal(digest(key, utf8(message)), createHmac('sha256', key).update(message, 'utf8').digest('hex'));
  }
});

test('offline MAC equality rejects differing bytes, lengths and non-byte arrays', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
  assert.equal(api.equalBytes(bytes, Uint8Array.from(bytes)), true);
  for (const index of [0, 15, 31]) {
    const different = Uint8Array.from(bytes); different[index] ^= 1;
    assert.equal(api.equalBytes(bytes, different), false);
  }
  assert.equal(api.equalBytes(bytes, bytes.subarray(1)), false);
  assert.equal(api.equalBytes(Array.from(bytes), bytes), false);
  assert.equal(api.equalBytes(bytes, null), false);
});
