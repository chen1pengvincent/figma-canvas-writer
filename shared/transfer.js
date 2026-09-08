// Chunk-transfer math shared by bridge and plugin UI. Pure JS.
import { LIMITS } from './limits.js';

// Number of chunks needed for a raw byte length (base64 transport payloads).
export function chunkCount(totalBytes) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new Error('非法字节数');
  if (totalBytes === 0) return 1;
  return Math.ceil(totalBytes / LIMITS.CHUNK_RAW_BYTES);
}

// Validate a transfer header the receiving side must check before buffering.
// `direction` is informational (the signed connection already binds direction);
// when present it must agree, but neither side is required to send it.
export function validateTransferHeader(header, direction) {
  if (!header || typeof header !== 'object') throw new Error('传输头必须是对象');
  if (header.direction !== undefined && direction !== undefined && header.direction !== direction) throw new Error('传输方向不符');
  if (typeof header.transferId !== 'string' || !/^[0-9a-zA-Z_-]{8,64}$/.test(header.transferId)) throw new Error('transferId 非法');
  if (typeof header.totalBytes !== 'number' || !Number.isSafeInteger(header.totalBytes) ||
      header.totalBytes < 0 || header.totalBytes > LIMITS.RESOURCE_BYTES) throw new Error('totalBytes 超出范围');
  if (typeof header.totalSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(header.totalSha256)) throw new Error('totalSha256 非法');
  return header;
}

export function base64ByteLength(value) {
  if (typeof value !== 'string' || value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

export function isValidTransferId(value) {
  return typeof value === 'string' && /^[0-9a-f]{16,64}$/i.test(value);
}
