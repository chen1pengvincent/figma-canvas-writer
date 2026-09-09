// Semantic read domain: queryNodes, getChildren, readField, getTextRuns and
// getDesignContext. Continuation cursors keep fixed membership (contract §7);
// field reads distinguish absent/mixed/unsupported/truncated and never invent
// values for unread fields.
import { LIMITS } from '../../shared/limits.js';
import { appErr, requireStr, requireNum, onlyKeys, isPlainObject, buildNodeInfo, cloneValue,
  utf16SafeBoundary, summarizeText, simpleTextDigest, pageOfNode, utf8ByteLength } from './util.js';
import { getNode, getContext } from './context.js';
import { createCursor, readCursor, touchCursor } from './records.js';

export const domainMeta = {
  name: 'semantic-read',
  actions: ['queryNodes', 'getChildren', 'readField', 'getTextRuns', 'getDesignContext'],
  preconditions: ['读取范围限当前授权页面；成员列表固定语义见施工文档 §7'],
  notes: ['不给未读字段编造默认值；区分 absent/mixed/unsupported/truncated'],
};

const OFFSET_CURSOR = /^(0|[1-9][0-9]*)$/;
const TEXT_SEGMENT_FIELDS = ['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration'];
const TEXT_RUN_LIMIT = 200;
const STRING_VALUE_LIMIT = 16000;
const JSON_VALUE_LIMIT = 24000;
const DESIGN_LAYERS = ['layout', 'bounds', 'text', 'components', 'variables', 'styles', 'assets'];
const DESIGN_DROP_ORDER = ['assets', 'styles', 'variables', 'text', 'components', 'bounds'];
const DESIGN_LAYOUT_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'layoutMode',
  'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
const DESIGN_STYLE_FIELDS = ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId', 'gridStyleId'];
const RESPONSE_CHAR_LIMIT = 200 * 1024;

// The shared registry only lets numeric cursor strings through schema
// validation, while records.createCursor issues opaque handles; numeric tokens
// bridge the two (raw handles stay accepted for when the schema widens).
const cursorTokens = new Map();
let cursorTokenSeq = 0;
function registerCursor(handleId) {
  const token = String(++cursorTokenSeq);
  cursorTokens.set(token, handleId);
  return token;
}
function resolveCursor(cursor) { return cursorTokens.get(cursor) || cursor; }

function requireInt(v, name, min, max) {
  const n = requireNum(v, name, min, max);
  if (!Number.isInteger(n)) throw appErr('INVALID_PARAM', `${name} 必须是整数`);
  return n;
}
function limitOf(p) { return p.limit === undefined ? 50 : requireInt(p.limit, 'limit', 1, 100); }
function projectionOf(p) {
  if (p.projection === undefined) return null;
  if (!Array.isArray(p.projection) || p.projection.some(k => typeof k !== 'string')) {
    throw appErr('INVALID_PARAM', 'projection 必须是字符串数组');
  }
  return p.projection;
}
function parseOffsetCursor(cursor) {
  if (typeof cursor !== 'string' || !OFFSET_CURSOR.test(cursor)) {
    throw appErr('INVALID_PARAM', 'cursor 必须是非负整数的字符串');
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  return offset;
}
function readBudget() { return { remaining: 100, remainingChars: 56000 }; }

// ---- queryNodes -------------------------------------------------------------
function collectScanNodes() {
  const page = figma.currentPage;
  const found = new Map();
  for (const child of page.children || []) found.set(child.id, child);
  if (typeof page.findAll === 'function') {
    try {
      for (const node of page.findAll(() => true) || []) if (!found.has(node.id)) found.set(node.id, node);
    } catch (e) { /* the manual walk below still covers the tree */ }
  }
  const walk = node => {
    for (const child of node.children || []) {
      if (!found.has(child.id)) found.set(child.id, child);
      walk(child);
    }
  };
  for (const child of page.children || []) walk(child);
  return [...found.values()];
}

function matchesCriteria(node, p) {
  if (p.type !== undefined && node.type !== p.type) return false;
  const name = String(node.name);
  if (p.nameContains !== undefined && !name.includes(p.nameContains)) return false;
  if (p.exactName !== undefined && name !== p.exactName) return false;
  return true;
}

async function handleQueryNodes(p, t) {
  onlyKeys(p, ['cursor', 'limit', 'type', 'nameContains', 'exactName', 'projection']);
  for (const k of ['type', 'nameContains', 'exactName']) if (p[k] !== undefined) requireStr(p[k], k);
  const projection = projectionOf(p);
  const limit = limitOf(p);
  // Handle cursors pin the member list at creation time (contract §7); a
  // numeric cursor keeps the legacy offset scan for one-shot small pages.
  if (p.cursor !== undefined && p.cursor.startsWith('h_')) {
    const record = readCursor(p.cursor);
    if (record.kind !== 'query') throw appErr('CURSOR_INVALID', '读取句柄类型不符');
    const budget = readBudget();
    const nodes = [];
    let expiredMembers = 0;
    const meta = record.meta;
    const start = meta.offset;
    const slice = meta.memberIds.slice(start, start + limit);
    for (const id of slice) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed || !onAuthorizedPage(node)) { expiredMembers++; meta.offset++; continue; }
      if (budget.remainingChars < 18000 && nodes.length) break;
      nodes.push(buildNodeInfo(node, 0, budget, meta.projection));
      meta.offset++;
    }
    touchCursor(p.cursor);
    const done = meta.offset >= meta.memberIds.length;
    return { ...getContext(), nodes, total: meta.memberIds.length, expiredMembers: expiredMembers || undefined,
      nextCursor: done ? null : p.cursor, truncated: !done };
  }
  const offset = p.cursor === undefined ? 0 : parseOffsetCursor(p.cursor);
  const matches = collectScanNodes().filter(node => matchesCriteria(node, p));
  const total = matches.length;
  if (offset > total) throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  const budget = readBudget();
  const nodes = [];
  for (const node of matches.slice(offset, offset + limit)) {
    if (budget.remainingChars < 18000 && nodes.length) break;
    nodes.push(buildNodeInfo(node, 0, budget, projection));
  }
  const next = offset + nodes.length;
  // Pin the full match list so continuation pages cannot drift when the
  // document changes between pages (fixed-membership continuation).
  let cursorId = null;
  let nextCursor = null;
  if (next < total) {
    try {
      cursorId = createCursor('query', {
        memberIds: matches.slice(next).map(node => node.id),
        offset: 0,
        projection,
      });
      nextCursor = cursorId;
    } catch (e) {
      if (e.code !== 'HANDLE_CAPACITY') throw e;
      nextCursor = String(next);
    }
  }
  return { ...getContext(), nodes, total, nextCursor, truncated: next < total,
    ...(cursorId ? {} : { offsetPagination: next < total ? true : undefined }) };
}

// ---- getChildren ------------------------------------------------------------
function onAuthorizedPage(node) {
  const page = pageOfNode(node);
  return !!page && page.id === getContext().pageId;
}

async function handleGetChildren(p, t, msg) {
  onlyKeys(p, ['cursor', 'limit', 'id', 'projection']);
  const limit = limitOf(p);
  const projection = projectionOf(p);
  if (p.cursor !== undefined) {
    if (typeof p.cursor !== 'string' || !p.cursor.length) throw appErr('INVALID_PARAM', 'cursor 必须是字符串');
    const handleId = resolveCursor(p.cursor);
    const record = readCursor(handleId, msg);
    if (record.kind !== 'children') throw appErr('INVALID_PARAM', '读取句柄类型不匹配');
    const memberIds = Array.isArray(record.meta.memberIds) ? record.meta.memberIds : [];
    if (p.id !== undefined && p.id !== record.meta.parentNodeId) {
      throw appErr('INVALID_PARAM', 'cursor 与 nodeId 不匹配');
    }
    const offset = Math.min(Math.max(0, Number(record.meta.offset) || 0), memberIds.length);
    const page = memberIds.slice(offset, offset + limit);
    const budget = readBudget();
    const nodes = [];
    let expiredMembers = 0;
    for (const memberId of page) {
      const node = await figma.getNodeByIdAsync(memberId);
      if (!node || node.removed || !onAuthorizedPage(node)) {
        expiredMembers += 1;
        nodes.push({ id: memberId, expired: true });
        continue;
      }
      nodes.push(buildNodeInfo(node, 0, budget, projection));
    }
    record.meta.offset = offset + page.length;
    touchCursor(handleId);
    const nextOffset = record.meta.offset < memberIds.length ? record.meta.offset : null;
    return { cursorId: p.cursor, nodes, total: memberIds.length, nextOffset, truncated: nextOffset !== null, expiredMembers };
  }
  const node = await getNode(p.id, t);
  const children = node.children || [];
  const memberIds = children.map(child => child.id);
  const budget = readBudget();
  const nodes = [];
  for (const child of children.slice(0, limit)) {
    if (budget.remainingChars < 18000 && nodes.length) break;
    nodes.push(buildNodeInfo(child, 0, budget, projection));
  }
  const handleId = createCursor('children', { parentNodeId: node.id, memberIds, offset: nodes.length });
  const cursorId = registerCursor(handleId);
  const nextOffset = nodes.length < memberIds.length ? nodes.length : null;
  return { cursorId, nodes, total: memberIds.length, nextOffset, truncated: nextOffset !== null };
}

// ---- readField --------------------------------------------------------------
function valueStatus(value, extra = {}) {
  if (typeof value === 'string' && value.length > STRING_VALUE_LIMIT) {
    return { status: 'truncated', value: value.slice(0, STRING_VALUE_LIMIT), valueLength: value.length, ...extra };
  }
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch (e) { return { status: 'unsupported', ...extra }; }
  if (serialized !== undefined && serialized.length > JSON_VALUE_LIMIT) {
    return { status: 'truncated', valueLength: serialized.length, ...extra };
  }
  return { status: 'value', value, ...extra };
}

function readFieldValue(node, key, range) {
  if (!(key in node)) return { status: 'absent' };
  let raw;
  try { raw = node[key]; }
  catch (e) { return { status: 'unsupported' }; }
  if (raw === undefined) return { status: 'absent' };
  if (raw === figma.mixed) return { status: 'mixed', value: { mixed: true } };
  if (key === 'characters' && range && typeof raw === 'string') {
    const start = Math.max(0, Math.min(range.start, raw.length));
    const end = Math.max(0, Math.min(range.end, raw.length));
    const actualStart = utf16SafeBoundary(raw, start);
    let actualEnd = utf16SafeBoundary(raw, end);
    if (actualEnd < actualStart) actualEnd = actualStart;
    return valueStatus(raw.slice(actualStart, actualEnd), { actualStart, actualEnd });
  }
  let value;
  try { value = cloneValue(raw); }
  catch (e) { return { status: 'unsupported' }; }
  return valueStatus(value);
}

async function handleReadField(p, t) {
  onlyKeys(p, ['nodeIds', 'fields', 'range']);
  if (!Array.isArray(p.nodeIds) || !p.nodeIds.length || p.nodeIds.some(id => typeof id !== 'string' || !id.length)) {
    throw appErr('INVALID_PARAM', 'nodeIds 必须是非空字符串数组');
  }
  if (!Array.isArray(p.fields) || !p.fields.length || p.fields.some(k => typeof k !== 'string' || !k.length)) {
    throw appErr('INVALID_PARAM', 'fields 必须是非空字符串数组');
  }
  let range = null;
  if (p.range !== undefined) {
    if (!isPlainObject(p.range)) throw appErr('INVALID_PARAM', 'range 必须是普通对象');
    onlyKeys(p.range, ['start', 'end']);
    const start = requireInt(p.range.start, 'range.start', 0, 1e9);
    const end = requireInt(p.range.end, 'range.end', 0, 1e9);
    if (end < start) throw appErr('INVALID_PARAM', 'range.end 不能小于 range.start');
    if (!p.fields.includes('characters')) throw appErr('INVALID_PARAM', 'range 仅适用于 characters 字段');
    range = { start, end };
  }
  // Cross-node byte budget: per-field values are already capped, but
  // nodeCount x fieldCount is not — without this gate the response can grow
  // far beyond the frame limit and kill the connection.
  const budgetBytes = LIMITS.READFIELD_BUDGET_BYTES;
  let usedBytes = 0;
  const results = [];
  const omittedNodeIds = [];
  let truncated = false;
  for (const id of p.nodeIds) {
    const node = await getNode(id, t);
    const fields = {};
    for (const key of p.fields) fields[key] = readFieldValue(node, key, range);
    const entry = { id: node.id, fields };
    const entryBytes = utf8ByteLength(entry);
    if (usedBytes + entryBytes > budgetBytes && results.length) {
      omittedNodeIds.push(node.id);
      truncated = true;
      continue;
    }
    if (entryBytes > budgetBytes) {
      // 单节点即超预算：字段降级为 omitted 标记，仍返回该节点条目
      const slimFields = {};
      for (const key of p.fields) slimFields[key] = { status: 'truncated', reason: 'response-budget' };
      const slimEntry = { id: node.id, fields: slimFields };
      results.push(slimEntry);
      usedBytes += utf8ByteLength(slimEntry);
      truncated = true;
      continue;
    }
    results.push(entry);
    usedBytes += entryBytes;
  }
  return { results, truncated: truncated || undefined,
    omittedNodeIds: omittedNodeIds.length ? omittedNodeIds : undefined,
    readFieldBudgetBytes: truncated ? budgetBytes : undefined, ...getContext() };
}

// ---- getTextRuns ------------------------------------------------------------
function textOf(node) {
  const value = node.characters;
  return typeof value === 'string' ? value : String(value ?? '');
}

function chunkText(characters, offset) {
  const raw = Math.min(offset + LIMITS.TEXT_CHUNK_CHARS, characters.length);
  const boundary = Math.max(offset, utf16SafeBoundary(characters, raw));
  return { text: characters.slice(offset, boundary), nextOffset: boundary < characters.length ? boundary : null };
}

async function handleGetTextRuns(p, t, msg) {
  onlyKeys(p, ['id', 'cursor']);
  if (p.cursor !== undefined) {
    if (typeof p.cursor !== 'string' || !p.cursor.length) throw appErr('INVALID_PARAM', 'cursor 必须是字符串');
    const handleId = resolveCursor(p.cursor);
    const record = readCursor(handleId, msg);
    if (record.kind !== 'text') throw appErr('INVALID_PARAM', '读取句柄类型不匹配');
    if (p.id !== undefined && p.id !== record.meta.nodeId) {
      throw appErr('INVALID_PARAM', 'cursor 与 nodeId 不匹配');
    }
    const node = await getNode(record.meta.nodeId, t);
    if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
    const characters = textOf(node);
    const digest = simpleTextDigest(characters);
    if (digest !== record.meta.digest) throw appErr('CURSOR_EXPIRED', '文本内容已变化，读取句柄已失效');
    const { text, nextOffset } = chunkText(characters, Number(record.meta.offset) || 0);
    record.meta.offset = nextOffset === null ? characters.length : nextOffset;
    touchCursor(handleId);
    return { cursorId: p.cursor, text, charactersLength: characters.length, contentDigest: digest, nextOffset };
  }
  const node = await getNode(p.id, t);
  if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
  const characters = textOf(node);
  const digest = simpleTextDigest(characters);
  const extra = {};
  let runs = [];
  try {
    const segments = node.getStyledTextSegments([...TEXT_SEGMENT_FIELDS]);
    const list = Array.isArray(segments) ? segments.map(segment => cloneValue(segment)) : [];
    if (list.length > TEXT_RUN_LIMIT) { extra.runsTruncated = true; runs = list.slice(0, TEXT_RUN_LIMIT); }
    else runs = list;
  } catch (e) { extra.runsUnsupported = true; }
  const { text, nextOffset } = chunkText(characters, 0);
  const handleId = createCursor('text', { nodeId: node.id, digest, offset: nextOffset === null ? characters.length : nextOffset });
  return { runs, ...extra, text, charactersLength: characters.length, nextOffset, cursorId: registerCursor(handleId), contentDigest: digest };
}

// ---- getDesignContext -------------------------------------------------------
function designSummary(node, include, depth, budget) {
  budget.remaining -= 1;
  const name = String(node.name);
  const summary = { id: node.id, name: name.slice(0, 1024), type: node.type, parentId: node.parent ? node.parent.id : null };
  const readErrors = [];
  if (include.has('layout')) {
    const layout = {};
    for (const k of DESIGN_LAYOUT_FIELDS) {
      if (!(k in node)) continue;
      try { const v = cloneValue(node[k]); if (v !== undefined) layout[k] = v; }
      catch (e) { readErrors.push(k); }
    }
    if (Object.keys(layout).length) summary.layout = layout;
  }
  if (include.has('bounds')) {
    if ('absoluteBoundingBox' in node) {
      try { const box = cloneValue(node.absoluteBoundingBox); if (box !== undefined && box !== null) summary.bounds = box; }
      catch (e) { readErrors.push('absoluteBoundingBox'); }
    } else readErrors.push('absoluteBoundingBox');
  }
  if (include.has('text') && node.type === 'TEXT') {
    try {
      const characters = textOf(node);
      summary.text = { characters: summarizeText(characters), charactersLength: characters.length };
    } catch (e) { readErrors.push('characters'); }
  }
  if (include.has('components') && (node.type === 'INSTANCE' || node.type === 'COMPONENT')) {
    try {
      if (node.type === 'INSTANCE') {
        const component = { componentId: cloneValue(node.componentId), name: summary.name };
        if ('key' in node) component.componentKey = cloneValue(node.key);
        if ('variantProperties' in node) component.variantProperties = cloneValue(node.variantProperties);
        summary.component = component;
      } else {
        const component = { componentId: node.id };
        if ('key' in node) component.componentKey = cloneValue(node.key);
        summary.component = component;
      }
    } catch (e) { readErrors.push('component'); }
  }
  if (include.has('variables') && 'boundVariables' in node) {
    try {
      const bindings = node.boundVariables;
      const variables = [];
      if (bindings && typeof bindings === 'object') {
        for (const field of Object.keys(bindings)) {
          const value = bindings[field];
          for (const item of Array.isArray(value) ? value : [value]) {
            if (item && typeof item === 'object' && item.id !== undefined && item.id !== null) {
              variables.push({ field, variableId: cloneValue(item.id) });
            }
          }
        }
      }
      if (variables.length) summary.variables = variables;
    } catch (e) { readErrors.push('boundVariables'); }
  }
  if (include.has('styles')) {
    const styles = {};
    for (const k of DESIGN_STYLE_FIELDS) {
      if (!(k in node)) continue;
      try { const v = cloneValue(node[k]); if (v !== undefined && v !== null) styles[k] = v; }
      catch (e) { readErrors.push(k); }
    }
    if (Object.keys(styles).length) summary.styles = styles;
  }
  if (include.has('assets') && 'fills' in node) {
    try {
      const fills = cloneValue(node.fills);
      const images = Array.isArray(fills)
        ? fills.filter(paint => paint && paint.type === 'IMAGE').map(paint => ({ imageHash: paint.imageHash, scaleMode: paint.scaleMode }))
        : [];
      if (images.length) summary.assets = images;
    } catch (e) { readErrors.push('fills'); }
  }
  if (readErrors.length) summary.readErrors = readErrors;
  budget.remainingChars -= JSON.stringify(summary).length + 64;
  const children = node.children || [];
  summary.childrenCount = children.length;
  if (depth > 0 && children.length) {
    summary.children = [];
    for (const child of children) {
      if (budget.remaining <= 0 || budget.remainingChars < 2000) break;
      summary.children.push(designSummary(child, include, depth - 1, budget));
    }
    if (summary.children.length < children.length || summary.children.some(child => child.truncated)) {
      summary.truncated = true;
    }
  }
  return summary;
}

async function handleGetDesignContext(p, t) {
  onlyKeys(p, ['id', 'scope', 'include', 'depth']);
  const scope = p.scope === undefined ? 'page' : p.scope;
  if (scope !== 'page' && scope !== 'node') throw appErr('INVALID_PARAM', 'scope 必须是 page 或 node');
  const depth = p.depth === undefined ? 2 : requireInt(p.depth, 'depth', 0, 6);
  const include = p.include === undefined ? [...DESIGN_LAYERS] : p.include;
  if (!Array.isArray(include) || include.some(k => !DESIGN_LAYERS.includes(k))) {
    throw appErr('INVALID_PARAM', 'include 含不支持的层');
  }
  let roots;
  if (scope === 'node') {
    if (p.id === undefined) throw appErr('INVALID_PARAM', 'scope=node 需要 nodeId');
    roots = [await getNode(p.id, t)];
  } else {
    roots = [...(figma.currentPage.children || [])];
  }
  const build = (includeSet, nodeCap) => {
    const budget = { remaining: Math.max(1, nodeCap), remainingChars: 4000000 };
    const nodes = [];
    for (const root of roots) {
      if (budget.remaining <= 0) break;
      nodes.push(designSummary(root, includeSet, depth, budget));
    }
    return { response: { scope, include: [...includeSet], depth, nodes }, rootsCut: nodes.length < roots.length };
  };
  const includeSet = new Set(include);
  let nodeCap = 2000;
  let built = build(includeSet, nodeCap);
  let size = JSON.stringify(built.response).length;
  const droppedLayers = [];
  if (size > RESPONSE_CHAR_LIMIT) {
    for (const layer of DESIGN_DROP_ORDER) {
      if (!includeSet.has(layer)) continue;
      includeSet.delete(layer);
      droppedLayers.push(layer);
      built = build(includeSet, nodeCap);
      size = JSON.stringify(built.response).length;
      if (size <= RESPONSE_CHAR_LIMIT) break;
    }
  }
  let listTruncated = false;
  while (size > RESPONSE_CHAR_LIMIT && nodeCap > 1) {
    nodeCap = Math.max(1, Math.floor(nodeCap / 2));
    listTruncated = true;
    built = build(includeSet, nodeCap);
    size = JSON.stringify(built.response).length;
  }
  if (size > RESPONSE_CHAR_LIMIT) {
    // Even a single node exceeds the transport budget: fail loudly instead of
    // emitting a response the UI cannot deliver.
    throw appErr('RESPONSE_TOO_LARGE', '设计上下文超过响应预算；请缩小 include 范围或降低 depth');
  }
  return {
    ...built.response,
    truncated: built.rootsCut || listTruncated || built.response.nodes.some(node => node.truncated === true),
    ...(droppedLayers.length ? { droppedLayers } : {}),
  };
}

export const handlers = {
  queryNodes: handleQueryNodes,
  getChildren: handleGetChildren,
  readField: handleReadField,
  getTextRuns: handleGetTextRuns,
  getDesignContext: handleGetDesignContext,
};
