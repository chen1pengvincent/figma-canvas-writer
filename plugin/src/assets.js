// Asset domain: screenshots, host-file exports, host-file imports and the
// background MP4 video job. Hash computation lives in the UI (noble), so the
// main thread only encodes/decodes base64 and touches the canvas.
import { LIMITS } from '../../shared/limits.js';
import { appErr, requireNum, requireStr, onlyKeys, isPlainObject } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';
import { registerUpload } from './entry.js';
import { parseSvgToVectors } from './svg-parser.js';

export const domainMeta = {
  name: 'assets',
  actions: ['getScreenshot', 'exportAsset', 'importAsset', 'exportVideo'],
  preconditions: ['Figma 已登录且文件可写；产物写入桥接配置目录 artifacts/；导入路径限于用户主目录或显式允许目录'],
  notes: ['MP4 仅顶层带动画 Frame；SVG 导入为有界解析子集，外链/脚本/嵌入内容拒绝；不支持 URL 导入'],
};

// ---- base64 (main thread) --------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const b0 = binary.charCodeAt(i);
    const b1 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : -1;
    const b2 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : -1;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
    out += b1 >= 0 ? B64[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '=';
    out += b2 >= 0 ? B64[b2 & 63] : '=';
  }
  return out;
}
export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) throw appErr('INVALID_ASSET', '资源编码不合法');
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const bytes = new Uint8Array(value.length * 3 / 4);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = lookup[value.charCodeAt(i)];
    const b = lookup[value.charCodeAt(i + 1)];
    const c = value.charCodeAt(i + 2) === 61 ? 255 : lookup[value.charCodeAt(i + 2)];
    const d = value.charCodeAt(i + 3) === 61 ? 255 : lookup[value.charCodeAt(i + 3)];
    if (a === undefined || b === undefined) throw appErr('INVALID_ASSET', '资源编码不合法');
    bytes[offset++] = (a << 2) | (b >> 4);
    if (c !== 255) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    if (d !== 255) bytes[offset++] = ((c & 3) << 6) | d;
  }
  return bytes.subarray(0, offset);
}
function utf8Length(text) {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) bytes += code > 0x7ff ? 2 : 1;
  }
  return bytes;
}

// ---- exports ---------------------------------------------------------------
async function exportBytes(node, settings) {
  const result = await node.exportAsync(settings);
  if (!(result instanceof Uint8Array) && typeof result !== 'string') {
    throw appErr('EXPORT_FAILED', '导出未返回字节');
  }
  return result;
}
function constraintFor(longEdge, width, height) {
  if (longEdge === undefined) return { type: 'SCALE', value: 1 };
  const size = Math.max(width, height);
  if (size <= 0) return { type: 'SCALE', value: 1 };
  return { type: 'SCALE', value: Math.min(1, longEdge / size) };
}

async function handleExportAsset(p, t, msg) {
  onlyKeys(p, ['id', 'format', 'scale', 'contentsOnly', 'useAbsoluteBounds', 'svgOutlineText', 'svgIdAttribute', 'svgSimplifyStroke', 'destination', 'transferId']);
  requireStr(p.id, 'id');
  const format = requireStr(p.format, 'format').toUpperCase();
  const node = await getNode(p.id, t);
  assertTarget(t);
  const base = {
    ...(p.contentsOnly !== undefined ? { contentsOnly: requireBool(p.contentsOnly, 'contentsOnly') } : {}),
    ...(p.useAbsoluteBounds !== undefined ? { useAbsoluteBounds: requireBool(p.useAbsoluteBounds, 'useAbsoluteBounds') } : {}),
  };
  let settings;
  if (format === 'PNG' || format === 'JPG') {
    settings = { ...base, format, constraint: { type: 'SCALE', value: p.scale === undefined ? 1 : requireNum(p.scale, 'scale', 0.01, 4) } };
  } else if (format === 'PDF') {
    settings = { ...base, format: 'PDF' };
  } else if (format === 'SVG') {
    settings = { ...base, format: p.destination === 'inline' ? 'SVG_STRING' : 'SVG',
      ...(p.svgOutlineText !== undefined ? { svgOutlineText: requireBool(p.svgOutlineText, 'svgOutlineText') } : {}),
      ...(p.svgIdAttribute !== undefined ? { svgIdAttribute: requireBool(p.svgIdAttribute, 'svgIdAttribute') } : {}),
      ...(p.svgSimplifyStroke !== undefined ? { svgSimplifyStroke: requireBool(p.svgSimplifyStroke, 'svgSimplifyStroke') } : {}) };
  } else {
    throw appErr('INVALID_PARAM', '不支持的导出格式');
  }
  if (format === 'PNG' || format === 'JPG') {
    const scale = p.scale === undefined ? 1 : p.scale;
    const pixels = node.width * scale * node.height * scale;
    if (pixels > LIMITS.BITMAP_PIXELS) {
      throw appErr('BITMAP_BUDGET', '导出超出 16,777,216 像素预算；请降低 scale 后重试，不静默改变导出要求');
    }
  }
  const data = await exportBytes(node, settings);
  assertTarget(t);
  if (format === 'SVG' && p.destination === 'inline') {
    const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    const size = utf8Length(text);
    if (size > LIMITS.INLINE_PREVIEW_BYTES) throw appErr('INLINE_TOO_LARGE', '内联 SVG 超过 128KiB，请使用 destination: file');
    return { inline: true, format: 'SVG', mime: 'image/svg+xml', bytes: size, data: text };
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (bytes.length > LIMITS.RESOURCE_BYTES) throw appErr('EXPORT_TOO_LARGE', '导出超过 16MiB 上限');
  requireStr(p.transferId, 'transferId');
  const base64 = bytesToBase64(bytes);
  await registerUpload(msg.id, p.transferId, msg.operationId || null, bytes.length, base64, {
    format, mime: { PNG: 'image/png', JPG: 'image/jpeg', SVG: 'image/svg+xml', PDF: 'application/pdf' }[format],
    width: Math.round(node.width), height: Math.round(node.height),
  });
  return { transferId: p.transferId, format, totalBytes: bytes.length, width: Math.round(node.width), height: Math.round(node.height) };
}

async function handleGetScreenshot(p, t, msg) {
  onlyKeys(p, ['id', 'longEdge', 'destination', 'transferId']);
  requireStr(p.id, 'id');
  const node = await getNode(p.id, t);
  const longEdge = p.longEdge === undefined ? LIMITS.PREVIEW_LONG_EDGE : requireNum(p.longEdge, 'longEdge', 64, LIMITS.PREVIEW_LONG_EDGE_MAX);
  let constraint = constraintFor(longEdge, node.width, node.height);
  const pixels = node.width * constraint.value * node.height * constraint.value;
  if (pixels > LIMITS.BITMAP_PIXELS) {
    throw appErr('BITMAP_BUDGET', '截图超出 16,777,216 像素预算；请减小 longEdge 或缩小节点后重试，不静默缩放');
  }
  const bytes = await exportBytes(node, { format: 'PNG', constraint, contentsOnly: true });
  assertTarget(t);
  if (!(bytes instanceof Uint8Array)) throw appErr('EXPORT_FAILED', '截图导出未返回字节');
  const width = Math.max(1, Math.round(node.width * constraint.value));
  const height = Math.max(1, Math.round(node.height * constraint.value));
  if (p.destination === 'file') {
    requireStr(p.transferId, 'transferId');
    await registerUpload(msg.id, p.transferId, null, bytes.length, bytesToBase64(bytes), { format: 'PNG', mime: 'image/png', width, height });
    return { transferId: p.transferId, format: 'PNG', totalBytes: bytes.length, width, height };
  }
  if (bytes.length <= LIMITS.INLINE_PREVIEW_BYTES) {
    return { inline: true, format: 'PNG', mime: 'image/png', bytes: bytes.length, width, height,
      data: 'data:image/png;base64,' + bytesToBase64(bytes) };
  }
  return { inline: true, format: 'PNG', mime: 'image/png', bytes: bytes.length, width, height,
    data: 'data:image/png;base64,' + bytesToBase64(bytes) };
}

// ---- import ----------------------------------------------------------------
async function handleImportAsset(p, t) {
  onlyKeys(p, ['format', 'fileName', 'totalBytes', 'totalSha256', 'assetBase64', 'x', 'y', 'parentId', 'name', 'transferId']);
  const format = requireStr(p.format, 'format').toUpperCase();
  if (p.assetBase64 === undefined) throw appErr('INVALID_ASSET', '资源未传输完整');
  const bytes = base64ToBytes(p.assetBase64);
  if (p.totalBytes !== undefined && bytes.length !== p.totalBytes) throw appErr('INVALID_ASSET', '资源字节数不符');
  const x = p.x === undefined ? 0 : requireNum(p.x, 'x', -1e6, 1e6);
  const y = p.y === undefined ? 0 : requireNum(p.y, 'y', -1e6, 1e6);
  let parent = null;
  if (p.parentId !== undefined) {
    parent = await getNode(p.parentId, t);
    if (!['FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'SECTION'].includes(parent.type)) throw appErr('INVALID_TARGET', 'parentId 必须是容器节点');
  }
  assertTarget(t);
  let node = null;
  try {
    if (format === 'PNG' || format === 'JPEG') {
      const image = figma.createImage(bytes);
      const size = await image.getSizeAsync();
      assertTarget(t);
      markMutation(t);
      node = figma.createRectangle();
      node.name = p.name || (p.fileName ? `img-${p.fileName}` : 'imported-image');
      node.resize(size.width, size.height);
      node.x = x; node.y = y;
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
      if (parent) parent.appendChild(node);
      t.affected.push(node.id);
    } else if (format === 'SVG') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const vectors = parseSvgToVectors(text);
      assertTarget(t);
      const created = [];
      for (const v of vectors) {
        markMutation(t);
        const vector = figma.createVector();
        if (v.vectorPaths) vector.vectorPaths = v.vectorPaths;
        if (v.vectorNetwork) vector.vectorNetwork = v.vectorNetwork;
        if (v.fills) vector.fills = v.fills;
        if (v.strokes) vector.strokes = v.strokes;
        if (v.strokeWeight !== undefined) vector.strokeWeight = v.strokeWeight;
        vector.x = x + (v.x || 0); vector.y = y + (v.y || 0);
        vector.name = p.name || (p.fileName ? `svg-${p.fileName}` : 'imported-svg');
        created.push(vector);
      }
      node = created[0];
      if (parent) parent.appendChild(node);
      if (created.length > 1) {
        const group = figma.group(created, parent || node.parent || figma.currentPage);
        group.name = p.name || (p.fileName ? `svg-group-${p.fileName}` : 'imported-svg-group');
        node = group;
      }
      t.affected.push(...created.map(n => n.id));
    } else {
      throw appErr('INVALID_ASSET', '不支持的导入格式');
    }
    return { id: node.id, name: node.name, format, bytes: bytes.length, totalSha256: p.totalSha256 || null };
  } catch (e) {
    if (e && e.code) throw e;
    if (node && !node.removed) { try { node.remove(); } catch {} }
    const detail = e instanceof Error ? (e.message || String(e)) : JSON.stringify(e);
    throw appErr('IMPORT_FAILED', '导入失败: ' + detail);
  }
}

// ---- video job -------------------------------------------------------------
export async function startVideoJob(p, t) {
  onlyKeys(p, ['id', 'format', 'fps', 'quality', 'scale', 'width', 'height', 'transferId']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (!node.parent || node.parent.type !== 'PAGE') throw appErr('INVALID_TARGET', '视频导出仅支持顶层 Frame');
  if (typeof node.exportAsync !== 'function') throw appErr('EDITOR_UNSUPPORTED', '当前环境不支持视频导出');
  const constraint = p.width !== undefined || p.height !== undefined
    ? { type: p.width !== undefined ? 'WIDTH' : 'HEIGHT', value: requireNum(p.width !== undefined ? p.width : p.height, 'constraint', 1, 3840) }
    : { type: 'SCALE', value: p.scale === undefined ? 1 : p.scale };
  const settings = {
    format: 'MP4',
    ...(p.fps !== undefined ? { fps: p.fps } : {}),
    ...(p.quality !== undefined ? { quality: p.quality } : {}),
    constraint,
  };
  const bytes = await exportBytes(node, settings);
  assertTarget(t);
  if (!(bytes instanceof Uint8Array)) throw appErr('EXPORT_FAILED', '视频导出未返回字节');
  if (bytes.length > LIMITS.RESOURCE_BYTES) throw appErr('EXPORT_TOO_LARGE', '视频超过 16MiB 上限');
  const transferId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
  await registerUpload(transferId, transferId, t.operationId || null, bytes.length, bytesToBase64(bytes), {
    format: 'MP4', mime: 'video/mp4', width: Math.round(node.width), height: Math.round(node.height),
  });
  return { format: 'MP4', totalBytes: bytes.length, width: Math.round(node.width), height: Math.round(node.height) };
}

// Plugin-side schema override: the bridge rewrites importAsset params.
export const schemas = {
  importAsset: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['PNG', 'JPEG', 'SVG'] },
      fileName: { type: 'string', maxLength: 1024 },
      totalBytes: { type: 'integer', minimum: 0, maximum: LIMITS.RESOURCE_BYTES },
      totalSha256: { type: 'string', maxLength: 64 },
      assetBase64: { type: 'string' },
      x: { type: 'number', minimum: -1e6, maximum: 1e6 },
      y: { type: 'number', minimum: -1e6, maximum: 1e6 },
      parentId: { type: 'string', maxLength: 1024 },
      name: { type: 'string', maxLength: 10000 },
    },
    required: ['format', 'assetBase64'],
    additionalProperties: false,
  },
};

export const handlers = {
  exportAsset: handleExportAsset,
  getScreenshot: handleGetScreenshot,
  importAsset: handleImportAsset,
};

function requireBool(v, name) {
  if (typeof v !== 'boolean') throw appErr('INVALID_PARAM', `${name} 必须是布尔值`);
  return v;
}
