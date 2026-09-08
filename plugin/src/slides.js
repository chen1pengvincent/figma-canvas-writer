// Slides domain: deck structure reads plus slide/slide-row/content writing.
// Gated to the Slides editor; the plugin never creates presentation files and
// offers no theme inference or template library search.
import { appErr, requireStr, requireNum, onlyKeys, isPlainObject, buildNodeInfo, validatePaints } from './util.js';
import { assertTarget, markMutation } from './context.js';
import { loadFont, loadNodeFonts } from './edit.js';

export const domainMeta = {
  name: 'slides',
  actions: ['listStructure', 'createSlide', 'createSlideRow', 'addContent', 'updateContent'],
  preconditions: ['需在已打开的 Slides 文件中运行插件'],
  notes: ['不新建演示文件；不提供主题推导或模板库检索'],
};

const INTER = { family: 'Inter', style: 'Regular' };
const CONTENT_TYPES = ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE'];
const CREATORS = { FRAME: 'createFrame', RECTANGLE: 'createRectangle', ELLIPSE: 'createEllipse', TEXT: 'createText', LINE: 'createLine' };
const STRUCTURE_LIMIT = 200;
const NAME_MAX = 1024;
// content.type is required by the shared registry schema for every slides
// action; updateContent ignores it and treats the rest as a property subset.
const UPDATE_CONTENT_KEYS = ['type', 'text', 'x', 'y', 'width', 'height', 'fontSize', 'fills', 'name'];

function assertSlides() {
  if (figma.editorType !== 'slides') throw appErr('EDITOR_UNSUPPORTED', '仅 Slides 编辑器可用');
}

// Slides live under figma.root in this editor, so the shared page-scoped
// getNode/markMutation checks (which assume PAGE parents) cannot apply to
// them; resolve targets directly and re-verify the auth generation instead.
async function findDeckNode(id, t) {
  requireStr(id, 'id');
  const node = await figma.getNodeByIdAsync(id);
  assertTarget(t);
  if (!node || node.removed) throw appErr('NODE_NOT_FOUND', `找不到节点: ${id}`);
  if (node.type === 'DOCUMENT' || node.type === 'PAGE') {
    throw appErr('INVALID_TARGET', '请以幻灯片或幻灯片内容节点为目标');
  }
  return node;
}

function rollbackCreation(e, node, t) {
  try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
  catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
}

async function listStructure(p, t) {
  onlyKeys(p, ['action']);
  assertTarget(t);
  const children = figma.root.children || [];
  const structure = children.slice(0, STRUCTURE_LIMIT).map(node => {
    const item = { id: node.id, type: node.type };
    if (node.name !== undefined) item.name = String(node.name).slice(0, NAME_MAX);
    if (Array.isArray(node.children)) item.childCount = node.children.length;
    return item;
  });
  return { structure, total: children.length, truncated: children.length > structure.length };
}

async function createSlideNode(p, t, creator) {
  onlyKeys(p, ['action', 'order', 'relativeToId']);
  let insertIndex = null;
  if (p.order === 'start') insertIndex = 0;
  if (p.order === 'before' || p.order === 'after') {
    if (p.relativeToId === undefined) {
      throw appErr('INVALID_PARAM', 'order 为 before/after 时必须提供 relativeToId');
    }
    const sibling = await findDeckNode(p.relativeToId, t);
    if (sibling.type !== 'SLIDE' && sibling.type !== 'SLIDE_ROW') {
      throw appErr('INVALID_TARGET', 'relativeToId 必须是幻灯片或幻灯片行');
    }
    const index = figma.root.children.indexOf(sibling);
    if (index === -1) throw appErr('INVALID_TARGET', 'relativeToId 必须是根层级的幻灯片或幻灯片行');
    insertIndex = p.order === 'before' ? index : index + 1;
  }
  assertTarget(t);
  markMutation(t);
  const node = creator();
  t.affected.push(node.id);
  try {
    // Creators land the node on the current page container; reposition it
    // into the deck root according to the requested order.
    if (insertIndex === null) figma.root.appendChild(node);
    else figma.root.insertChild(insertIndex, node);
  } catch (e) {
    rollbackCreation(e, node, t);
    throw e;
  }
  return buildNodeInfo(node);
}

async function createSlide(p, t) {
  return createSlideNode(p, t, () => figma.createSlide());
}

async function createSlideRow(p, t) {
  return createSlideNode(p, t, () => figma.createSlideRow());
}

async function addContent(p, t) {
  onlyKeys(p, ['action', 'slideId', 'content']);
  requireStr(p.slideId, 'slideId');
  const content = p.content;
  if (!isPlainObject(content)) throw appErr('INVALID_PARAM', 'content 必须是普通对象');
  if (!CONTENT_TYPES.includes(content.type)) {
    throw appErr('INVALID_PARAM', `content.type 不在允许值中: ${content.type}`);
  }
  if (content.type === 'LINE' && content.height !== undefined) {
    throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
  }
  if (content.type !== 'TEXT') {
    if (content.text !== undefined) throw appErr('INVALID_PARAM', 'text 只用于 TEXT 类型内容');
    if (content.fontSize !== undefined) throw appErr('INVALID_PARAM', 'fontSize 只用于 TEXT 类型内容');
  }
  const slide = await findDeckNode(p.slideId, t);
  if (slide.type !== 'SLIDE') throw appErr('INVALID_TARGET', '目标不是幻灯片');
  if (content.x !== undefined) requireNum(content.x, 'content.x', -1e6, 1e6);
  if (content.y !== undefined) requireNum(content.y, 'content.y', -1e6, 1e6);
  if (content.width !== undefined) requireNum(content.width, 'content.width', 1, 1e5);
  if (content.height !== undefined) requireNum(content.height, 'content.height', 1, 1e5);
  if (content.name !== undefined) requireStr(content.name, 'content.name', { allowEmpty: true });
  if (content.fills !== undefined) validatePaints(content.fills, 'content.fills');
  if (content.type === 'TEXT') {
    requireStr(content.text, 'content.text', { allowEmpty: true });
    if (content.fontSize !== undefined) requireNum(content.fontSize, 'content.fontSize', 1, 1000);
  }
  // Load fonts before creating so a failure leaves no residue.
  if (content.type === 'TEXT') await loadFont(INTER);
  assertTarget(t);
  markMutation(t);
  const node = figma[CREATORS[content.type]]();
  t.affected.push(node.id);
  try {
    // Creators append to the current page; apply properties while the node is
    // still there, then re-parent it onto the target slide.
    if (typeof slide.appendChild !== 'function') {
      throw appErr('UNSUPPORTED', '当前环境不支持向幻灯片添加内容');
    }
    if (content.name !== undefined) node.name = content.name;
    if (content.x !== undefined) node.x = content.x;
    if (content.y !== undefined) node.y = content.y;
    if (content.width !== undefined || content.height !== undefined) {
      node.resize(content.width !== undefined ? content.width : node.width,
        content.type === 'LINE' ? 0 : content.height !== undefined ? content.height : node.height);
    }
    if (content.type === 'TEXT') {
      if (content.fontSize !== undefined) node.fontSize = content.fontSize;
      node.characters = content.text;
    }
    if (content.fills !== undefined) node.fills = validatePaints(content.fills, 'content.fills');
    slide.appendChild(node);
  } catch (e) {
    rollbackCreation(e, node, t);
    throw e;
  }
  return buildNodeInfo(node);
}

async function updateContent(p, t) {
  onlyKeys(p, ['action', 'id', 'content']);
  requireStr(p.id, 'id');
  const content = p.content;
  if (!isPlainObject(content)) throw appErr('INVALID_PARAM', 'content 必须是普通对象');
  for (const key of Object.keys(content)) {
    if (!UPDATE_CONTENT_KEYS.includes(key)) throw appErr('INVALID_PARAM', `不支持的内容属性: ${key}`);
  }
  const node = await findDeckNode(p.id, t);
  if (node.type === 'LINE' && content.height !== undefined) {
    throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
  }
  if (content.x !== undefined) requireNum(content.x, 'content.x', -1e6, 1e6);
  if (content.y !== undefined) requireNum(content.y, 'content.y', -1e6, 1e6);
  if (content.width !== undefined) requireNum(content.width, 'content.width', 1, 1e5);
  if (content.height !== undefined) requireNum(content.height, 'content.height', 1, 1e5);
  if (content.name !== undefined) requireStr(content.name, 'content.name', { allowEmpty: true });
  if (content.text !== undefined) requireStr(content.text, 'content.text', { allowEmpty: true });
  if (content.fontSize !== undefined) requireNum(content.fontSize, 'content.fontSize', 1, 1000);
  if (content.fills !== undefined) validatePaints(content.fills, 'content.fills');
  const isText = node.type === 'TEXT';
  for (const key of Object.keys(content)) {
    if (key === 'type') continue;
    if (key === 'width' || key === 'height') {
      if (typeof node.resize !== 'function') throw appErr('UNSUPPORTED_PROPERTY', '节点不能调整尺寸');
      continue;
    }
    if (key === 'text' || key === 'fontSize') {
      if (!isText) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${key}`);
      continue;
    }
    if (!(key in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${key}`);
  }
  if (isText && (content.text !== undefined || content.fontSize !== undefined)) await loadNodeFonts(node);
  assertTarget(t);
  markMutation(t);
  if (!t.affected.includes(node.id)) t.affected.push(node.id);
  try {
    if (content.name !== undefined) node.name = content.name;
    if (content.x !== undefined) node.x = content.x;
    if (content.y !== undefined) node.y = content.y;
    if (content.width !== undefined || content.height !== undefined) {
      node.resize(content.width !== undefined ? content.width : node.width,
        node.type === 'LINE' ? 0 : content.height !== undefined ? content.height : node.height);
    }
    if (isText && content.fontSize !== undefined) node.fontSize = content.fontSize;
    if (isText && content.text !== undefined) node.characters = content.text;
    if (content.fills !== undefined) node.fills = validatePaints(content.fills, 'content.fills');
  } catch (e) {
    e.state = t.mutating ? 'partial' : 'not_started';
    throw e;
  }
  return buildNodeInfo(node);
}

async function handleSlides(p, t) {
  assertSlides();
  switch (p.action) {
    case 'listStructure': return listStructure(p, t);
    case 'createSlide': return createSlide(p, t);
    case 'createSlideRow': return createSlideRow(p, t);
    case 'addContent': return addContent(p, t);
    case 'updateContent': return updateContent(p, t);
    default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
  }
}

export const handlers = {
  slides: handleSlides,
};
