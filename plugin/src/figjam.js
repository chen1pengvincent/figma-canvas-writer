// FigJam domain: native sticky notes, shape-with-text and connectors, plus a
// read-only node listing. Gated to the FigJam editor; no Mermaid parsing,
// automatic diagram layout or chart generation services are offered.
import { appErr, requireStr, requireNum, onlyKeys, buildNodeInfo } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';
import { loadFont } from './edit.js';

export const domainMeta = {
  name: 'figjam',
  actions: ['createSticky', 'updateSticky', 'createShapeWithText', 'createConnector', 'updateConnector', 'listNodes'],
  preconditions: ['需在已打开的 FigJam 文件中运行插件'],
  notes: ['不提供 Mermaid 解析、自动图布局或官方图表生成服务', 'listNodes 为偏移式分页，不固定成员列表；跨页调用可能漂移'],
};

const INTER = { family: 'Inter', style: 'Regular' };
const MAGNETS = new Set(['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'CENTER']);
const SHAPE_TYPES = new Set(['SQUARE', 'ELLIPSE', 'DIAMOND', 'TRIANGLE_UP', 'TRIANGLE_DOWN', 'ROUNDED_RECTANGLE',
  'HEXAGON', 'CLOUD', 'PARALLELOGRAM_RIGHT', 'PARALLELOGRAM_LEFT', 'STAR', 'SPEECH_BUBBLE', 'PIE']);
const LIST_NODE_TYPES = ['STICKY', 'SHAPE_WITH_TEXT', 'CONNECTOR'];
const CURSOR_RE = /^(0|[1-9][0-9]*)$/;
const NAME_MAX = 1024;
const LIST_CHARS_MAX = 200;

function assertFigJam() {
  if (figma.editorType !== 'figjam') throw appErr('EDITOR_UNSUPPORTED', '仅 FigJam 编辑器可用');
}

function requireText(p) {
  return requireStr(p.text, 'text', { allowEmpty: true });
}

// Sticky/shape text lives on a text subnode in native FigJam, but some
// runtimes only expose a characters property; support both states loosely.
function writeLooseText(node, text) {
  if (node.text) node.text.characters = text;
  else node.characters = text;
}

function rollbackCreation(e, node, t) {
  try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
  catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
}

async function createSticky(p, t) {
  onlyKeys(p, ['action', 'x', 'y', 'text', 'name']);
  requireNum(p.x, 'x', -1e6, 1e6);
  requireNum(p.y, 'y', -1e6, 1e6);
  requireText(p);
  if (p.name !== undefined) requireStr(p.name, 'name', { allowEmpty: true });
  await loadFont(INTER);
  assertTarget(t);
  markMutation(t);
  const node = figma.createSticky();
  t.affected.push(node.id);
  try {
    markMutation(t, node);
    node.x = p.x;
    node.y = p.y;
    writeLooseText(node, p.text);
    if (p.name !== undefined) node.name = p.name;
  } catch (e) {
    rollbackCreation(e, node, t);
    throw e;
  }
  return buildNodeInfo(node);
}

async function updateSticky(p, t) {
  onlyKeys(p, ['action', 'id', 'text']);
  requireText(p);
  const node = await getNode(requireStr(p.id, 'id'), t);
  if (node.type !== 'STICKY') throw appErr('INVALID_TARGET', '目标不是 FigJam 便笺');
  await loadFont(INTER);
  assertTarget(t);
  markMutation(t, node);
  writeLooseText(node, p.text);
  return buildNodeInfo(node);
}

async function createShapeWithText(p, t) {
  onlyKeys(p, ['action', 'x', 'y', 'text', 'shapeType']);
  requireNum(p.x, 'x', -1e6, 1e6);
  requireNum(p.y, 'y', -1e6, 1e6);
  requireText(p);
  if (p.shapeType !== undefined && !SHAPE_TYPES.has(p.shapeType)) {
    throw appErr('INVALID_PARAM', `shapeType 不在允许值中: ${p.shapeType}`);
  }
  await loadFont(INTER);
  assertTarget(t);
  markMutation(t);
  const node = figma.createShapeWithText();
  t.affected.push(node.id);
  try {
    markMutation(t, node);
    node.x = p.x;
    node.y = p.y;
    if (p.shapeType !== undefined && 'shapeType' in node) node.shapeType = p.shapeType;
    writeLooseText(node, p.text);
  } catch (e) {
    rollbackCreation(e, node, t);
    throw e;
  }
  return buildNodeInfo(node);
}

function connectEndpoint(connector, side, node, magnet) {
  const endpoint = connector[side];
  if (!endpoint) return;
  if (typeof endpoint.connectTo !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持连接线端点绑定');
  }
  if (magnet === undefined) endpoint.connectTo(node);
  else endpoint.connectTo(node, magnet);
}

async function createConnector(p, t) {
  onlyKeys(p, ['action', 'startNodeId', 'endNodeId', 'startMagnet', 'endMagnet']);
  requireStr(p.startNodeId, 'startNodeId');
  requireStr(p.endNodeId, 'endNodeId');
  for (const key of ['startMagnet', 'endMagnet']) {
    if (p[key] !== undefined && !MAGNETS.has(p[key])) {
      throw appErr('INVALID_PARAM', `${key} 不在允许值中: ${p[key]}`);
    }
  }
  const startNode = await getNode(p.startNodeId, t);
  const endNode = await getNode(p.endNodeId, t);
  assertTarget(t);
  markMutation(t);
  const connector = figma.createConnector();
  t.affected.push(connector.id);
  try {
    markMutation(t, connector);
    connectEndpoint(connector, 'start', startNode, p.startMagnet);
    connectEndpoint(connector, 'end', endNode, p.endMagnet);
  } catch (e) {
    rollbackCreation(e, connector, t);
    throw e;
  }
  const out = { id: connector.id, startNodeId: startNode.id, endNodeId: endNode.id };
  if (p.startMagnet !== undefined) out.startMagnet = p.startMagnet;
  if (p.endMagnet !== undefined) out.endMagnet = p.endMagnet;
  return out;
}

async function updateConnector(p, t) {
  onlyKeys(p, ['action', 'id', 'text']);
  requireText(p);
  const node = await getNode(requireStr(p.id, 'id'), t);
  if (node.type !== 'CONNECTOR') throw appErr('INVALID_TARGET', '目标不是连接线');
  assertTarget(t);
  markMutation(t, node);
  if ('textCharacters' in node) node.textCharacters = p.text;
  else if (node.text) node.text.characters = p.text;
  else node.characters = p.text;
  return buildNodeInfo(node);
}

function readLooseCharacters(node) {
  try {
    if ('textCharacters' in node) return node.textCharacters;
    if (node.text) return node.text.characters;
    if ('characters' in node) return node.characters;
  } catch (e) { /* unreadable characters are omitted */ }
  return undefined;
}

async function listNodes(p, t) {
  onlyKeys(p, ['action', 'cursor', 'limit']);
  assertTarget(t);
  const limit = p.limit === undefined ? 50 : requireNum(p.limit, 'limit', 1, 100);
  if (!Number.isInteger(limit)) throw appErr('INVALID_PARAM', 'limit 必须是整数');
  if (p.cursor !== undefined && (typeof p.cursor !== 'string' || !CURSOR_RE.test(p.cursor))) {
    throw appErr('INVALID_PARAM', 'cursor 必须是非负整数的字符串');
  }
  const all = figma.currentPage.children.filter(node => LIST_NODE_TYPES.includes(node.type));
  const offset = p.cursor === undefined ? 0 : Number(p.cursor);
  if (!Number.isSafeInteger(offset) || offset > all.length) {
    throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  }
  const nodes = all.slice(offset, offset + limit).map(node => {
    const item = { id: node.id, type: node.type, name: String(node.name).slice(0, NAME_MAX) };
    const characters = readLooseCharacters(node);
    if (typeof characters === 'string') {
      if (characters.length > LIST_CHARS_MAX) {
        item.characters = characters.slice(0, LIST_CHARS_MAX);
        item.truncated = true;
      } else item.characters = characters;
    }
    return item;
  });
  const next = offset + nodes.length;
  return {
    nodes, total: all.length,
    nextCursor: next < all.length ? String(next) : null,
    truncated: next < all.length,
  };
}

async function handleFigjam(p, t) {
  assertFigJam();
  switch (p.action) {
    case 'createSticky': return createSticky(p, t);
    case 'updateSticky': return updateSticky(p, t);
    case 'createShapeWithText': return createShapeWithText(p, t);
    case 'createConnector': return createConnector(p, t);
    case 'updateConnector': return updateConnector(p, t);
    case 'listNodes': return listNodes(p, t);
    default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
  }
}

export const handlers = {
  figjam: handleFigjam,
};
