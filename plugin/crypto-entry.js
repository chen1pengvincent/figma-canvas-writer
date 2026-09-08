// Figma's sandboxed UI supports secure randomness but may not expose crypto.subtle.
// Build this pinned implementation into ui.html; never fetch executable code at runtime.
import { hmac } from '../bridge/node_modules/@noble/hashes/hmac.js';
import { sha256 } from '../bridge/node_modules/@noble/hashes/sha2.js';

window.FCWCrypto = Object.freeze({
  hmacSha256(key, message) { return hmac(sha256, key, message); },
  equalBytes(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
    // Compare every byte. JavaScript runtimes do not promise constant-time execution.
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
  },
});
