import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeContext as sharedNormalizeContext } from '../shared/context.js';

export const AUTH_PROTOCOL = 3;
export const AUTH_DOMAIN = 'figma-canvas-writer/v3';
export const KEY_RE = /^[0-9a-f]{64}$/i;

// Sorted JSON is shared with the WebCrypto implementation in plugin/ui.html.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => v === undefined ? 'null' : canonical(v)).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function sign(key, value) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(canonical(value), 'utf8').digest('hex');
}

export function verify(key, value, mac) {
  if (typeof mac !== 'string' || !KEY_RE.test(mac)) return false;
  return timingSafeEqual(Buffer.from(sign(key, value), 'hex'), Buffer.from(mac, 'hex'));
}

export function authProof(kind, serverNonce, clientNonce, context, connectionId) {
  return {
    domain: AUTH_DOMAIN, kind, protocol: AUTH_PROTOCOL, serverNonce, clientNonce, context,
    ...(connectionId === undefined ? {} : { connectionId }),
  };
}

export function frameProof(direction, connectionId, seq, payload) {
  return { domain: AUTH_DOMAIN, kind: direction + '-frame', connectionId, seq, payload };
}

export function normalizeContext(value, options = {}) {
  return sharedNormalizeContext(value, options);
}
