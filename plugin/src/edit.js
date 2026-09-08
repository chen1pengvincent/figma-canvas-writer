// Core editing commands with the original public contract: createNode,
// modifyNode, deleteNode, setText. Domain extensions live in hierarchy.js,
// vector.js, layout.js, text-range.js and visual.js.
import { appErr, requireStr, requireNum, requireBool, hasOwn, onlyKeys, isPlainObject, buildNodeInfo, pageOfNode, validatePaints } from './util.js';
import { getNode, getContext, assertTarget, markMutation } from './context.js';

const CREATE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'];
const MODIFY_PROPS = new Set(['name', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'visible', 'fills', 'strokes', 'strokeWeight', 'cornerRadius']);

function validateModifyProps(props) {
  if (!isPlainObject(props)) throw appErr('INVALID_PARAM', 'props 必须是普通对象');
  const out = {};
  for (const key of Object.keys(props)) {
    if (!MODIFY_PROPS.has(key)) throw appErr('INVALID_PARAM', `属性不在白名单内: ${key}`);
    const v = props[key];
    switch (key) {
      case 'name': out.name = requireStr(v, 'name', { allowEmpty: true }); break;
      case 'x': out.x = requireNum(v, 'x', -1e6, 1e6); break;
      case 'y': out.y = requireNum(v, 'y', -1e6, 1e6); break;
      case 'width': out.width = requireNum(v, 'width', 0.01, 1e5); break;
      case 'height': out.height = requireNum(v, 'height', 0, 1e5); break;
      case 'rotation': out.rotation = requireNum(v, 'rotation', -360, 360); break;
      case 'opacity': out.opacity = requireNum(v, 'opacity', 0, 1); break;
      case 'visible': out.visible = requireBool(v, 'visible'); break;
      case 'strokeWeight': out.strokeWeight = requireNum(v, 'strokeWeight', 0, 1e5); break;
      case 'cornerRadius': out.cornerRadius = requireNum(v, 'cornerRadius', 0, 1e5); break;
      case 'fills': out.fills = validatePaints(v, 'fills'); break;
      case 'strokes': out.strokes = validatePaints(v, 'strokes'); break;
    }
  }
  return out;
}

async function loadFont(font) {
  try { await figma.loadFontAsync(font); }
  catch (e) { throw appErr('FONT_NOT_LOADABLE', `无法加载字体 ${font.family} ${font.style}`); }
}
async function loadNodeFonts(node, extra) {
  let fonts = [];
  if (extra) fonts = [extra];
  else if (node.characters.length) fonts = node.getRangeAllFontNames(0, node.characters.length);
  else if (node.fontName !== figma.mixed) fonts = [node.fontName];
  const seen = new Set();
  for (const f of fonts) {
    const key = JSON.stringify(f);
    if (!seen.has(key)) { seen.add(key); await loadFont(f); }
  }
}
function preflightProps(node, props) {
  for (const k of Object.keys(props)) {
    if (!(k in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${k}`);
  }
  if (hasOwn(props, 'width') || hasOwn(props, 'height')) {
    if (typeof node.resize !== 'function') throw appErr('UNSUPPORTED_PROPERTY', '节点不能调整尺寸');
    const w = hasOwn(props, 'width') ? props.width : node.width;
    const h = hasOwn(props, 'height') ? props.height : node.height;
    requireNum(w, 'width', 0.01, 1e5);
    if (node.type === 'LINE') {
      if (h !== 0) throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
    } else requireNum(h, 'height', 0.01, 1e5);
  }
}
export function applyProps(node, props, t) {
  preflightProps(node, props);
  const applied = [];
  try {
    for (const k of Object.keys(props)) {
      if (k === 'width' || k === 'height') continue;
      markMutation(t, node); node[k] = props[k]; applied.push(k);
    }
    if (hasOwn(props, 'width') || hasOwn(props, 'height')) {
      markMutation(t, node);
      node.resize(hasOwn(props, 'width') ? props.width : node.width,
        node.type === 'LINE' ? 0 : hasOwn(props, 'height') ? props.height : node.height);
      applied.push('size');
    }
  } catch (e) {
    const failure = appErr('PROP_APPLY_FAILED', e.message);
    failure.state = t.mutating ? 'partial' : 'not_started';
    failure.details = { appliedProperties: applied };
    if (t.mutating && !node.removed && pageOfNode(node) && pageOfNode(node).id === t.pageId) failure.details.readBack = buildNodeInfo(node);
    throw failure;
  }
}

async function handleCreateNode(p, t) {
  onlyKeys(p, ['type', 'name', 'x', 'y', 'width', 'height', 'parentId', 'text', 'props']);
  if (!CREATE_TYPES.includes(p.type)) throw appErr('INVALID_PARAM', '不支持创建该类型');
  const props = p.props === undefined ? {} : validateModifyProps(p.props);
  for (const k of ['name', 'x', 'y', 'width', 'height']) {
    if (hasOwn(p, k)) {
      if (hasOwn(props, k)) throw appErr('INVALID_PARAM', `重复指定属性 ${k}`);
      Object.assign(props, validateModifyProps({ [k]: p[k] }));
    }
  }
  if (p.type === 'TEXT') requireStr(p.text, 'text', { allowEmpty: true });
  else if (p.text !== undefined) throw appErr('INVALID_PARAM', 'text 只用于 TEXT');
  if (hasOwn(props, 'height')) {
    if (p.type === 'LINE' && props.height !== 0) throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
    if (p.type !== 'LINE') requireNum(props.height, 'height', 0.01, 1e5);
  }
  const parent = p.parentId === undefined ? null : await getNode(p.parentId, t);
  if (parent && parent.type !== 'FRAME') throw appErr('INVALID_TARGET', 'parentId 必须是当前页 FRAME');
  const font = { family: 'Inter', style: 'Regular' };
  if (p.type === 'TEXT') await loadFont(font);
  assertTarget(t);
  if (parent && (parent.removed || !pageOfNode(parent) || pageOfNode(parent).id !== t.pageId)) throw appErr('PAGE_CHANGED', '父节点已移出当前授权页面或被移除');
  let node;
  try {
    const creators = { RECTANGLE: 'createRectangle', ELLIPSE: 'createEllipse', TEXT: 'createText',
      FRAME: 'createFrame', LINE: 'createLine', STAR: 'createStar' };
    markMutation(t);
    node = figma[creators[p.type]]();
    t.affected.push(node.id);
    if (parent) parent.appendChild(node);
    if (p.type === 'TEXT') { node.fontName = font; node.characters = p.text; }
    applyProps(node, props, t);
    return buildNodeInfo(node);
  } catch (e) {
    if (node) {
      try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
      catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
    } else e.state = 'unknown';
    throw e;
  }
}
async function handleModifyNode(p, t) {
  onlyKeys(p, ['id', 'props']);
  const props = validateModifyProps(p.props);
  const node = await getNode(p.id, t);
  preflightProps(node, props);
  if (node.type === 'TEXT' && (hasOwn(props, 'width') || hasOwn(props, 'height'))) await loadNodeFonts(node);
  assertTarget(t);
  applyProps(node, props, t);
  return buildNodeInfo(node);
}
async function handleSetText(p, t) {
  onlyKeys(p, ['id', 'text', 'fontName', 'fontSize', 'x', 'y']);
  if (p.text !== undefined) requireStr(p.text, 'text', { allowEmpty: true });
  if (p.fontSize !== undefined) requireNum(p.fontSize, 'fontSize', 1, 1000);
  for (const k of ['x', 'y']) if (p[k] !== undefined) requireNum(p[k], k, -1e6, 1e6);
  if (p.fontName !== undefined) {
    onlyKeys(p.fontName, ['family', 'style']);
    requireStr(p.fontName.family, 'fontName.family'); requireStr(p.fontName.style, 'fontName.style');
  }
  const node = await getNode(p.id, t);
  if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
  if (p.fontName !== undefined || p.fontSize !== undefined || p.text !== undefined) await loadNodeFonts(node, p.fontName);
  assertTarget(t);
  try {
    for (const k of ['fontName', 'fontSize', 'text', 'x', 'y']) {
      if (!hasOwn(p, k)) continue;
      markMutation(t, node); node[k === 'text' ? 'characters' : k] = p[k];
    }
  } catch (e) { e.state = t.mutating ? 'partial' : 'not_started'; throw e; }
  return buildNodeInfo(node);
}
async function handleDeleteNode(p, t) {
  onlyKeys(p, ['id']);
  const node = await getNode(p.id, t);
  markMutation(t, node); node.remove();
  return { id: p.id, deleted: true };
}

export const handlers = {
  createNode: handleCreateNode,
  modifyNode: handleModifyNode,
  setText: handleSetText,
  deleteNode: handleDeleteNode,
};
export { validateModifyProps, preflightProps, loadNodeFonts, loadFont };
