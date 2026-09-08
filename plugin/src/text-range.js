// Text-range domain: character-range style reads and writes on TEXT nodes.
// Ranges are clamped into the text and corrected onto UTF-16 code-point
// boundaries so a range never splits a surrogate pair. Fonts are loaded before
// the first mutation; fonts that cannot be loaded are reported as
// FONT_NOT_LOADABLE and never silently replaced.
import {
  appErr, requireStr, requireNum, hasOwn, onlyKeys, isPlainObject,
  cloneValue, utf16SafeBoundary, summarizeText, validatePaints,
} from './util.js';
import { getNode, getContext, assertTarget, markMutation } from './context.js';
import { loadFont, loadNodeFonts } from './edit.js';

export const domainMeta = {
  name: 'text-range',
  actions: ['getStyles', 'setStyles'],
  preconditions: [],
  notes: [
    'setStyles 写前加载字体，加载失败报 FONT_NOT_LOADABLE，不静默替换字体',
    '区间 clamp 到 [0, characters.length] 并按 UTF-16 修正，不落在代理对中间',
    'getStyles 对倒置区间按 [min,max] 读取；setStyles 拒绝修正后 end<=start 的区间',
    '节点缺失 getRange*/setRange* 方法时如实返回 unsupported，不编造默认值',
  ],
};

const STYLE_KEYS = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills', 'textCase', 'textDecoration'];
const APPLY_ORDER = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills', 'textCase', 'textDecoration'];
const READ_METHODS = {
  fontName: 'getRangeFontName', fontSize: 'getRangeFontSize', lineHeight: 'getRangeLineHeight',
  letterSpacing: 'getRangeLetterSpacing', fills: 'getRangeFills', textCase: 'getRangeTextCase',
  textDecoration: 'getRangeTextDecoration',
};
const WRITE_METHODS = {
  fontName: 'setRangeFontName', fontSize: 'setRangeFontSize', lineHeight: 'setRangeLineHeight',
  letterSpacing: 'setRangeLetterSpacing', fills: 'setRangeFills', textCase: 'setRangeTextCase',
  textDecoration: 'setRangeTextDecoration',
};
const SEGMENT_FIELDS = ['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration'];
const SEGMENT_LIMIT = 100;
const LINE_HEIGHT_UNITS = ['PIXELS', 'PERCENT', 'AUTO'];
const LETTER_SPACING_UNITS = ['PIXELS', 'PERCENT'];
const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'];
const TEXT_DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'];

function requireRangeIndex(v, name) {
  if (!Number.isInteger(v) || v < 0) throw appErr('INVALID_PARAM', `${name} 必须是非负整数`);
  return v;
}

// Clamp start/end into [0, characters.length], then correct each boundary onto
// a surrogate-safe index. Reads normalize an inverted range to [min, max];
// writes reject a corrected range that is empty (end <= start).
function resolveRange(text, p, { rejectInverted }) {
  const len = text.length;
  const rawStart = p.start === undefined ? 0 : requireRangeIndex(p.start, 'start');
  const rawEnd = p.end === undefined ? len : requireRangeIndex(p.end, 'end');
  let start = utf16SafeBoundary(text, Math.min(rawStart, len));
  let end = utf16SafeBoundary(text, Math.min(rawEnd, len));
  if (rejectInverted) {
    if (end <= start) {
      throw appErr('INVALID_PARAM', `修正后区间为空（actualStart=${start}, actualEnd=${end}）；setStyles 要求 end > start`);
    }
  } else if (end < start) {
    const swapped = start;
    start = end;
    end = swapped;
  }
  return { start, end };
}

function readRangeStyles(node, start, end) {
  const styles = {};
  for (const key of STYLE_KEYS) {
    const method = READ_METHODS[key];
    if (typeof node[method] !== 'function') { styles[key] = { status: 'unsupported' }; continue; }
    try {
      const value = cloneValue(node[method](start, end));
      styles[key] = value === undefined ? { status: 'unsupported' } : value;
    } catch (e) { styles[key] = { status: 'unsupported' }; }
  }
  return styles;
}

function readSegments(node, start, end) {
  if (typeof node.getStyledTextSegments !== 'function') return { segments: [], segmentsTotal: 0 };
  let raw = [];
  try { raw = node.getStyledTextSegments(SEGMENT_FIELDS, start, end) || []; }
  catch (e) { return { segments: [], segmentsTotal: 0 }; }
  const segments = raw.slice(0, SEGMENT_LIMIT).map((segment) => {
    const out = {};
    if (typeof segment.characters === 'string') out.characters = summarizeText(segment.characters, 64);
    if (segment.start !== undefined) out.start = segment.start;
    if (segment.end !== undefined) out.end = segment.end;
    for (const key of STYLE_KEYS) {
      if (!(key in segment)) continue;
      const value = cloneValue(segment[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  });
  return {
    segments, segmentsTotal: raw.length,
    ...(raw.length > SEGMENT_LIMIT ? { segmentsTruncated: true } : {}),
  };
}

async function handleGetStyles(p, t) {
  const node = await getNode(p.id, t);
  if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
  const characters = node.characters;
  const { start, end } = resolveRange(characters, p, { rejectInverted: false });
  return {
    id: node.id,
    charactersLength: characters.length,
    actualStart: start,
    actualEnd: end,
    styles: readRangeStyles(node, start, end),
    ...readSegments(node, start, end),
    ...getContext(),
  };
}

function normalizeUnitValue(v, name, units, min, max) {
  if (!isPlainObject(v)) throw appErr('INVALID_PARAM', `${name} 必须是数值或 {unit, value} 对象`);
  onlyKeys(v, ['unit', 'value']);
  if (!units.includes(v.unit)) throw appErr('INVALID_PARAM', `${name}.unit 非法: ${String(v.unit)}`);
  return { unit: v.unit, value: requireNum(v.value, `${name}.value`, min, max) };
}

function normalizeStyles(raw) {
  if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', 'styles 必须是普通对象且至少包含一项样式');
  const keys = Object.keys(raw);
  if (!keys.length) throw appErr('INVALID_PARAM', 'styles 至少包含一项要修改的样式');
  const out = {};
  for (const key of keys) {
    if (!STYLE_KEYS.includes(key)) throw appErr('INVALID_PARAM', `不支持的样式字段: ${key}`);
    const v = raw[key];
    if (key === 'fontName') {
      if (!isPlainObject(v)) throw appErr('INVALID_PARAM', 'fontName 必须是 {family, style} 对象');
      onlyKeys(v, ['family', 'style']);
      out.fontName = { family: requireStr(v.family, 'fontName.family'), style: requireStr(v.style, 'fontName.style') };
    } else if (key === 'fontSize') {
      out.fontSize = requireNum(v, 'fontSize', 1, 1000);
    } else if (key === 'lineHeight') {
      out.lineHeight = typeof v === 'number'
        ? { unit: 'PIXELS', value: requireNum(v, 'lineHeight', 0, 1e5) }
        : normalizeUnitValue(v, 'lineHeight', LINE_HEIGHT_UNITS, 0, 1e5);
    } else if (key === 'letterSpacing') {
      out.letterSpacing = typeof v === 'number'
        ? { unit: 'PIXELS', value: requireNum(v, 'letterSpacing', -1e5, 1e5) }
        : normalizeUnitValue(v, 'letterSpacing', LETTER_SPACING_UNITS, -1e5, 1e5);
    } else if (key === 'fills') {
      out.fills = validatePaints(v, 'fills');
    } else if (key === 'textCase') {
      if (!TEXT_CASES.includes(v)) throw appErr('INVALID_PARAM', `textCase 非法: ${String(v)}`);
      out.textCase = v;
    } else if (key === 'textDecoration') {
      if (!TEXT_DECORATIONS.includes(v)) throw appErr('INVALID_PARAM', `textDecoration 非法: ${String(v)}`);
      out.textDecoration = v;
    }
  }
  return out;
}

async function handleSetStyles(p, t) {
  const styles = normalizeStyles(p.styles);
  const node = await getNode(p.id, t);
  if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
  const { start, end } = resolveRange(node.characters, p, { rejectInverted: true });
  if (styles.fontName) await loadFont(styles.fontName);
  else await loadNodeFonts(node);
  for (const key of Object.keys(styles)) {
    const method = WRITE_METHODS[key];
    if (typeof node[method] !== 'function') {
      throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${method}`);
    }
  }
  assertTarget(t);
  const applied = [];
  try {
    for (const key of APPLY_ORDER) {
      if (!hasOwn(styles, key)) continue;
      markMutation(t, node);
      node[WRITE_METHODS[key]](start, end, styles[key]);
      applied.push(key);
    }
  } catch (e) {
    const failure = appErr('PROP_APPLY_FAILED', e.message);
    failure.state = t.mutating ? 'partial' : 'not_started';
    failure.details = { appliedProperties: applied, appliedStart: start, appliedEnd: end };
    throw failure;
  }
  assertTarget(t);
  return {
    id: node.id,
    charactersLength: node.characters.length,
    appliedStart: start,
    appliedEnd: end,
    appliedProperties: applied,
    styles: readRangeStyles(node, start, end),
    ...getContext(),
  };
}

async function handleTextRange(p, t) {
  onlyKeys(p, ['id', 'action', 'start', 'end', 'styles', 'cursor']);
  if (p.action === 'getStyles') return handleGetStyles(p, t);
  if (p.action === 'setStyles') return handleSetStyles(p, t);
  throw appErr('INVALID_PARAM', 'action 必须是 getStyles 或 setStyles');
}

export const handlers = {
  textRange: handleTextRange,
};
