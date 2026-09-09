// Shared plugin-side utilities: validation helpers, node info builder,
// target checks and mutation tracking. Bundled into plugin/code.js.

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
export function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
export function appErr(code, message) { const e = new Error(message); e.code = code; return e; }
export function isFiniteNum(v, min, max) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }
export function requireStr(v, name, opts = {}) {
  if (typeof v !== 'string' || (!opts.allowEmpty && !v.length)) throw appErr('INVALID_PARAM', `${name} 必须是字符串`);
  return v;
}
export function requireNum(v, name, min, max) {
  if (!isFiniteNum(v, min, max)) throw appErr('INVALID_PARAM', `${name} 必须在 [${min}, ${max}] 内`);
  return v;
}
export function requireBool(v, name) {
  if (typeof v !== 'boolean') throw appErr('INVALID_PARAM', `${name} 必须是布尔值`);
  return v;
}
export function onlyKeys(p, keys) {
  if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
  for (const k of Object.keys(p)) if (!keys.includes(k)) throw appErr('INVALID_PARAM', `未知参数: ${k}`);
}
export function cloneValue(v) {
  if (v === figma.mixed) return { mixed: true };
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}
export function pageOfNode(node) {
  let n = node;
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') n = n.parent;
  return n && n.type === 'PAGE' ? n : null;
}

export function buildNodeInfo(node, depth = 0, budget = { remaining: 100, remainingChars: 56000 }, fields = null) {
  budget.remaining--;
  const name = String(node.name);
  const info = { id: node.id, name: name.slice(0, 1024), type: node.type, parentId: node.parent ? node.parent.id : null };
  if (name.length > 1024) { info.nameTruncated = true; info.nameLength = name.length; }
  const errors = [];
  const truncatedFields = [];
  budget.remainingChars -= JSON.stringify(info).length + 256;
  const wanted = fields || ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked',
    'fills', 'strokes', 'strokeWeight', 'cornerRadius', 'fontName', 'fontSize', 'characters'];
  for (const k of wanted) {
    if (!(k in node)) continue;
    try {
      let v = cloneValue(node[k]);
      if (k === 'characters' && typeof v === 'string' && v.length > 16000) {
        info.charactersLength = v.length; info.charactersTruncated = true; v = v.slice(0, 16000);
      }
      if (v !== undefined) {
        const size = JSON.stringify(v).length;
        if (size > 24000 || size > budget.remainingChars) { truncatedFields.push(k); continue; }
        budget.remainingChars -= size + k.length + 4;
        info[k] = v;
      }
    } catch (e) { errors.push(k); }
  }
  const children = node.children || [];
  info.childrenCount = children.length;
  if (depth > 0 && children.length) {
    info.children = [];
    for (const child of children) {
      if (budget.remaining <= 0 || budget.remainingChars < 2000) break;
      info.children.push(buildNodeInfo(child, depth - 1, budget, fields));
    }
  }
  info.truncated = children.length > ((info.children || []).length) || !!(info.children || []).find(n => n.truncated);
  if (errors.length) info.readErrors = errors;
  if (truncatedFields.length) { info.truncatedFields = truncatedFields; info.truncated = true; }
  return info;
}

export function paginate(nodes, p, getContext) {
  onlyKeys(p, ['cursor', 'limit']);
  const limit = p.limit === undefined ? 50 : requireNum(p.limit, 'limit', 1, 100);
  if (!Number.isInteger(limit)) throw appErr('INVALID_PARAM', 'limit 必须是整数');
  if (p.cursor !== undefined && (typeof p.cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(p.cursor))) throw appErr('INVALID_PARAM', 'cursor 必须是非负整数的字符串');
  const offset = p.cursor === undefined ? 0 : Number(p.cursor);
  if (!Number.isSafeInteger(offset) || offset > nodes.length) throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  const budget = { remaining: 100, remainingChars: 56000 };
  const selected = [];
  for (const n of nodes.slice(offset, offset + limit)) {
    if (budget.remainingChars < 18000 && selected.length) break;
    selected.push(buildNodeInfo(n, 0, budget));
  }
  const next = offset + selected.length;
  return { ...getContext(), nodes: selected, total: nodes.length,
    nextCursor: next < nodes.length ? String(next) : null, truncated: next < nodes.length };
}

export function hexToRgb01(hex) {
  if (typeof hex !== 'string') throw appErr('INVALID_PARAM', 'color 必须是字符串或 {r,g,b} 对象');
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) throw appErr('INVALID_PARAM', `非法 hex 颜色: ${hex}（需 #RRGGBB 或 #RGB）`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}

const PAINT_TYPES = new Set(['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI', 'SHADER']);

export function validatePaints(v, name) {
  if (!Array.isArray(v)) throw appErr('INVALID_PARAM', `${name} 必须是数组`);
  if (v.length > 32) throw appErr('INVALID_PARAM', `${name} 数量超过 32`);
  const out = [];
  for (const paint of v) {
    if (!isPlainObject(paint)) throw appErr('INVALID_PARAM', `${name} 元素必须是普通对象`);
    if (typeof paint.type !== 'string' || !PAINT_TYPES.has(paint.type)) {
      throw appErr('INVALID_PARAM', `${name} 元素 type 非法`);
    }
    if (paint.type === 'SOLID') {
      let c = paint.color;
      if (typeof c === 'string') c = hexToRgb01(c);
      if (!isPlainObject(c)) throw appErr('INVALID_PARAM', 'SOLID 填充需要 color');
      for (const ch of ['r', 'g', 'b']) {
        if (!isFiniteNum(c[ch], 0, 1)) throw appErr('INVALID_PARAM', `color.${ch} 需在 [0,1]`);
      }
      if (c.a !== undefined && !isFiniteNum(c.a, 0, 1)) throw appErr('INVALID_PARAM', 'color.a 需在 [0,1]');
      if (c.a !== undefined && paint.opacity !== undefined && c.a !== paint.opacity) {
        throw appErr('INVALID_PARAM', 'color.a 与 opacity 冲突');
      }
      const normalized = { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b } };
      const opacity = paint.opacity === undefined ? c.a : paint.opacity;
      if (opacity !== undefined) normalized.opacity = requireNum(opacity, 'opacity', 0, 1);
      if (paint.visible !== undefined) normalized.visible = requireBool(paint.visible, 'visible');
      if (paint.blendMode !== undefined) normalized.blendMode = requireStr(paint.blendMode, 'blendMode');
      if (paint.boundVariables !== undefined) normalized.boundVariables = JSON.parse(JSON.stringify(paint.boundVariables));
      const allowed = new Set(['type', 'color', 'opacity', 'visible', 'blendMode', 'boundVariables']);
      for (const key of Object.keys(paint)) if (!allowed.has(key)) throw appErr('INVALID_PARAM', `不支持 SOLID.${key}`);
      for (const key of Object.keys(c)) if (!['r', 'g', 'b', 'a'].includes(key)) throw appErr('INVALID_PARAM', `不支持 color.${key}`);
      out.push(normalized);
    } else {
      out.push(JSON.parse(JSON.stringify(paint)));
    }
  }
  return out;
}

export function utf16SafeBoundary(text, index) {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return index - 1;
  return index;
}

export function summarizeText(text, maxChars = 64) {
  if (typeof text !== 'string') return null;
  if (text.length <= maxChars * 2) return text;
  return { length: text.length, head: text.slice(0, maxChars), tail: text.slice(-maxChars) };
}

const byteEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
// Byte-accurate size of a JSON-serializable value (UTF-8), matching what the
// WebSocket frame check measures. Falls back to a CJK-aware estimate when the
// realm lacks TextEncoder.
export function utf8ByteLength(value) {
  const serialized = JSON.stringify(value ?? null);
  if (byteEncoder) return byteEncoder.encode(serialized).length;
  let bytes = serialized.length;
  for (let i = 0; i < serialized.length; i++) {
    const code = serialized.charCodeAt(i);
    if (code > 0x7f) bytes += code > 0x7ff ? 2 : 1;
  }
  return bytes;
}

export function simpleTextDigest(text) {
  if (typeof text !== 'string') return null;
  // Content marker strong enough to detect any realistic edit: length, a
  // rolling hash and the head/tail samples. Handles never join two versions.
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return [text.length, hash.toString(36),
    text.slice(0, 64), text.slice(-64)].join('|');
}
