// Design-system domain: local variables/collections/modes, local shared
// styles, components/variants/instances and team-library discovery/import.
// All data returned is JSON-plain; lists are capped and budget-bounded.
import { LIMITS } from '../../shared/limits.js';
import { appErr, requireStr, requireNum, requireBool, isPlainObject, isFiniteNum,
  hasOwn, onlyKeys, cloneValue, validatePaints } from './util.js';
import { getContext, getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'design-system',
  actions: [
    'listCollections', 'listVariables', 'getVariable', 'createVariable', 'renameVariable', 'deleteVariable',
    'setValue', 'createMode', 'renameMode', 'deleteMode', 'resolveValue', 'setBoundVariable',
    'list', 'get', 'create', 'update', 'apply', 'delete',
    'createFromNode', 'createInstance', 'combineAsVariants', 'swap', 'detach', 'getInstanceInfo',
    'setInstanceProperty', 'addComponentProperty', 'editComponentProperty', 'deleteComponentProperty',
    'importVariable', 'importComponent', 'importStyle',
  ],
  preconditions: ['teamlibrary 权限已声明；库发现需用户已在 Figma UI 启用库'],
  notes: [
    '变量重命名经 name 属性赋值、删除经 remove()；模式经 collection.addMode(name)/renameMode(modeId,name)/removeMode(modeId)',
    'setBoundVariable 官方签名为 (field, Variable|null)；fills/strokes 经 setBoundVariableForPaint(paint,"color",variable) 逐 paint 绑定',
    '样式 lineHeight/letterSpacing 按工具契约数字传参，落地为 {unit:"PIXELS", value}；TEXT 创建/更新先 loadFontAsync',
    '样式应用优先 set*StyleIdAsync，缺失时退回 *StyleId 属性赋值',
    'combineAsVariants 需要 nodeIds(2..64)、createInstance 需要 parentId，共享注册表 figma_components 暂无这两个字段，线上调用会被 schema 拒绝（待契约修订）',
    'variables 的 value 在共享注册表中限定为 object，FLOAT/BOOLEAN/STRING 原始值会在 schema 层被拒（待契约修订）',
    '列表返回截断 + truncated 标记，响应预算 ≤256KiB（LIMITS.FRAME_BYTES）',
  ],
};

const BUDGET_BYTES = LIMITS.FRAME_BYTES - 2048;
const RESOLVED_TYPES = ['BOOLEAN', 'FLOAT', 'COLOR', 'STRING'];
const STYLE_TYPES = ['PAINT', 'TEXT', 'EFFECT', 'GRID'];
const STYLE_GETTERS = {
  PAINT: 'getLocalPaintStylesAsync', TEXT: 'getLocalTextStylesAsync',
  EFFECT: 'getLocalEffectStylesAsync', GRID: 'getLocalGridStylesAsync',
};
const STYLE_CREATORS = {
  PAINT: 'createPaintStyle', TEXT: 'createTextStyle',
  EFFECT: 'createEffectStyle', GRID: 'createGridStyle',
};
const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'];
const TEXT_DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'];
const EFFECT_TYPES = ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'];
const GRID_PATTERNS = ['GRID', 'COLUMNS', 'ROWS'];
const COMPONENT_TYPES = ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
const PROPERTY_TYPES = ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT'];
const BOUND_NODE_FIELDS = new Set([
  'width', 'height', 'characters', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'visible', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'counterAxisSpacing', 'strokeWeight',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'opacity',
  'gridRowGap', 'gridColumnGap',
]);

// ---- shared helpers ---------------------------------------------------------
function requireEditor() {
  if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '设计系统命令仅在 Figma Design 文件中可用');
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function str(value) { return value === undefined || value === null ? null : String(value).slice(0, 1024); }
function summarizeValue(value, cap = 512) {
  if (value === undefined) return null;
  let json;
  try { json = JSON.stringify(value); } catch { return String(value); }
  if (json === undefined || json.length <= cap) return value;
  return { truncated: true, preview: json.slice(0, cap) };
}
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}
function listEnvelope(items, cap, total) {
  const count = total === undefined ? items.length : total;
  const data = { ...getContext(), items: items.slice(0, cap), total: count, truncated: count > cap };
  if (utf8Length(JSON.stringify(data)) <= BUDGET_BYTES) return data;
  while (data.items.length > 1 && utf8Length(JSON.stringify(data)) > BUDGET_BYTES) {
    data.items.length = Math.max(1, Math.floor(data.items.length / 2));
  }
  data.truncated = true;
  return data;
}
function wrapApiError(e, what) {
  if (e && e.code) throw e;
  throw appErr('PLUGIN_ERROR', `${what} 失败: ${e && e.message ? e.message : String(e)}`);
}

// ---- variables --------------------------------------------------------------
function validateVariableValue(resolvedType, value) {
  const mismatch = (detail) => appErr('INVALID_PARAM', `value 与 resolvedType=${resolvedType} 不符: ${detail}`);
  if (resolvedType === 'FLOAT') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw mismatch('需要有限数字');
    return value;
  }
  if (resolvedType === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw mismatch('需要布尔值');
    return value;
  }
  if (resolvedType === 'STRING') {
    if (typeof value !== 'string') throw mismatch('需要字符串');
    return value;
  }
  if (!isPlainObject(value)) throw mismatch('需要 {r,g,b,a} 对象');
  for (const ch of ['r', 'g', 'b']) {
    if (!isFiniteNum(value[ch], 0, 1)) throw mismatch(`color.${ch} 需在 [0,1]`);
  }
  if (value.a !== undefined && !isFiniteNum(value.a, 0, 1)) throw mismatch('color.a 需在 [0,1]');
  for (const key of Object.keys(value)) {
    if (!['r', 'g', 'b', 'a'].includes(key)) throw mismatch(`不支持 color.${key}`);
  }
  return { r: value.r, g: value.g, b: value.b, ...(value.a !== undefined ? { a: value.a } : {}) };
}

function variableSummary(variable) {
  const values = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode || {})) {
    values[modeId] = summarizeValue(cloneValue(value));
  }
  return { id: variable.id, name: str(variable.name), resolvedType: variable.resolvedType, valuesByMode: values };
}
function variableInfo(variable) {
  return {
    ...variableSummary(variable),
    key: variable.key ?? null,
    remote: !!variable.remote,
    variableCollectionId: variable.variableCollectionId ?? null,
    ...(typeof variable.description === 'string' ? { description: variable.description.slice(0, 2048) } : {}),
  };
}
async function fetchVariable(variableId, t) {
  requireStr(variableId, 'variableId');
  if (typeof figma.variables.getVariableByIdAsync !== 'function') {
    throw appErr('UNSUPPORTED', 'figma.variables.getVariableByIdAsync 不可用');
  }
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  assertTarget(t);
  if (!variable) throw appErr('NODE_NOT_FOUND', `找不到变量: ${variableId}`);
  return variable;
}
async function fetchCollection(collectionId, t) {
  requireStr(collectionId, 'collectionId');
  if (typeof figma.variables.getVariableCollectionByIdAsync !== 'function') {
    throw appErr('UNSUPPORTED', 'figma.variables.getVariableCollectionByIdAsync 不可用');
  }
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  assertTarget(t);
  if (!collection) throw appErr('NODE_NOT_FOUND', `找不到变量集合: ${collectionId}`);
  return collection;
}
async function fetchMode(collection, modeId) {
  const mode = (collection.modes || []).find(m => m.modeId === modeId);
  if (!mode) throw appErr('NODE_NOT_FOUND', `集合 ${collection.id} 中找不到模式: ${modeId}`);
  return mode;
}

async function handleVariables(p, t) {
  requireEditor();
  onlyKeys(p, ['action', 'id', 'collectionId', 'variableId', 'modeId', 'field', 'name', 'resolvedType', 'value', 'expectedCollectionName']);
  const variables = figma.variables;
  switch (p.action) {
    case 'listCollections': {
      if (typeof variables.getLocalVariableCollectionsAsync !== 'function') {
        throw appErr('UNSUPPORTED', 'figma.variables.getLocalVariableCollectionsAsync 不可用');
      }
      assertTarget(t);
      const collections = await variables.getLocalVariableCollectionsAsync();
      assertTarget(t);
      const items = (collections || []).map(collection => ({
        id: collection.id, name: str(collection.name), remote: !!collection.remote,
        modes: plain(collection.modes || []),
        defaultModeId: collection.defaultModeId ?? null,
        variableIds: (collection.variableIds || []).slice(0, 100),
        variableCount: (collection.variableIds || []).length,
      }));
      return listEnvelope(items, 100);
    }
    case 'listVariables': {
      const collection = await fetchCollection(p.collectionId, t);
      if (typeof variables.getLocalVariablesAsync !== 'function') {
        throw appErr('UNSUPPORTED', 'figma.variables.getLocalVariablesAsync 不可用');
      }
      const all = await variables.getLocalVariablesAsync();
      assertTarget(t);
      const items = (all || []).filter(v => v.variableCollectionId === collection.id).map(variableSummary);
      return listEnvelope(items, 200);
    }
    case 'getVariable':
      return variableInfo(await fetchVariable(p.variableId, t));
    case 'createCollection': {
      onlyKeys(p, ['action', 'name']);
      requireStr(p.name, 'name');
      assertTarget(t);
      if (typeof figma.variables?.createVariableCollection !== 'function') throw appErr('UNSUPPORTED', 'figma.variables.createVariableCollection 不可用');
      markMutation(t);
      const collection = figma.variables.createVariableCollection(p.name);
      return { collectionId: collection.id, name: collection.name,
        modes: collection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name })), variableIds: [] };
    }
    case 'createVariable': {
      requireStr(p.name, 'name');
      requireStr(p.collectionId, 'collectionId');
      if (!RESOLVED_TYPES.includes(p.resolvedType)) throw appErr('INVALID_PARAM', `resolvedType 必须是 ${RESOLVED_TYPES.join('/')}`);
      const value = p.value === undefined ? undefined : validateVariableValue(p.resolvedType, p.value);
      const collection = await fetchCollection(p.collectionId, t);
      if (collection.remote) throw appErr('INVALID_TARGET', '远程（库）集合不能创建本地变量');
      if (p.expectedCollectionName !== undefined && String(collection.name) !== p.expectedCollectionName) {
        throw appErr('TARGET_MISMATCH', '集合名称与预期不符，已拒绝创建');
      }
      if (typeof variables.createVariable !== 'function') throw appErr('UNSUPPORTED', 'figma.variables.createVariable 不可用');
      assertTarget(t);
      markMutation(t);
      const variable = variables.createVariable(p.name, collection, p.resolvedType);
      if (value !== undefined) variable.setValueForMode(collection.defaultModeId, value);
      return { ...variableSummary(variable), collectionId: collection.id, key: variable.key ?? null,
        ...(value !== undefined ? { defaultValueSet: true } : {}) };
    }
    case 'renameVariable': {
      requireStr(p.name, 'name');
      const variable = await fetchVariable(p.variableId, t);
      markMutation(t);
      variable.name = p.name;
      return { id: variable.id, name: variable.name };
    }
    case 'deleteVariable': {
      const variable = await fetchVariable(p.variableId, t);
      markMutation(t);
      variable.remove();
      return { id: p.variableId, deleted: true };
    }
    case 'setValue': {
      requireStr(p.modeId, 'modeId');
      if (!hasOwn(p, 'value') || p.value === undefined) throw appErr('INVALID_PARAM', 'value 必填');
      const variable = await fetchVariable(p.variableId, t);
      const collection = await fetchCollection(variable.variableCollectionId, t);
      await fetchMode(collection, p.modeId);
      const value = validateVariableValue(variable.resolvedType, p.value);
      if (typeof variable.setValueForMode !== 'function') throw appErr('UNSUPPORTED', 'variable.setValueForMode 不可用');
      markMutation(t);
      variable.setValueForMode(p.modeId, value);
      return { id: variable.id, modeId: p.modeId, resolvedType: variable.resolvedType, value: summarizeValue(value) };
    }
    case 'createMode': {
      requireStr(p.name, 'name');
      const collection = await fetchCollection(p.collectionId, t);
      if (typeof collection.addMode !== 'function') throw appErr('UNSUPPORTED', 'collection.addMode 不可用');
      markMutation(t);
      const modeId = collection.addMode(p.name);
      return { collectionId: collection.id, modeId, name: p.name, modes: plain(collection.modes || []) };
    }
    case 'renameMode': {
      requireStr(p.name, 'name');
      const collection = await fetchCollection(p.collectionId, t);
      await fetchMode(collection, p.modeId);
      if (typeof collection.renameMode !== 'function') throw appErr('UNSUPPORTED', 'collection.renameMode 不可用');
      markMutation(t);
      collection.renameMode(p.modeId, p.name);
      return { collectionId: collection.id, modeId: p.modeId, name: p.name };
    }
    case 'deleteMode': {
      const collection = await fetchCollection(p.collectionId, t);
      await fetchMode(collection, p.modeId);
      if (typeof collection.removeMode !== 'function') {
        throw appErr('UNSUPPORTED', '当前 Plugin API 未提供 collection.removeMode，无法删除模式');
      }
      if ((collection.modes || []).length <= 1) throw appErr('INVALID_TARGET', '集合至少需要保留一个模式');
      markMutation(t);
      collection.removeMode(p.modeId);
      return { collectionId: collection.id, modeId: p.modeId, deleted: true, modes: plain(collection.modes || []) };
    }
    case 'resolveValue': {
      const variable = await fetchVariable(p.variableId, t);
      if (!variable.valuesByMode || !hasOwn(variable.valuesByMode, p.modeId)) {
        throw appErr('NODE_NOT_FOUND', `变量 ${variable.id} 中找不到模式: ${p.modeId}`);
      }
      return { id: variable.id, modeId: p.modeId, resolvedType: variable.resolvedType,
        value: summarizeValue(cloneValue(variable.valuesByMode[p.modeId])) };
    }
    case 'setBoundVariable': {
      requireStr(p.field, 'field');
      const node = await getNode(p.id, t);
      const variable = await fetchVariable(p.variableId, t);
      assertTarget(t);
      markMutation(t, node);
      if (p.field === 'fills' || p.field === 'strokes') {
        // Paint-level binding: the official node field list does not include
        // fills/strokes; they are bound per paint via setBoundVariableForPaint.
        const paints = node[p.field];
        if (!Array.isArray(paints) || paints.length === 0) throw appErr('INVALID_PARAM', `${p.field} 为空，无法绑定变量`);
        const bind = variables && typeof variables.setBoundVariableForPaint === 'function' ? variables.setBoundVariableForPaint : null;
        if (!bind) throw appErr('UNSUPPORTED', 'figma.variables.setBoundVariableForPaint 不可用');
        const bound = paints.map(paint => bind(cloneValue(paint), 'color', variable));
        node[p.field] = bound;
        return { nodeId: node.id, field: p.field, variableId: variable.id, via: 'setBoundVariableForPaint' };
      }
      if (!BOUND_NODE_FIELDS.has(p.field)) {
        throw appErr('INVALID_PARAM', `field 必须是 fills/strokes 或节点可绑定字段: ${[...BOUND_NODE_FIELDS].join('/')}`);
      }
      if (typeof node.setBoundVariable !== 'function') throw appErr('UNSUPPORTED', 'node.setBoundVariable 不可用');
      node.setBoundVariable(p.field, variable);
      return { nodeId: node.id, field: p.field, variableId: variable.id, via: 'setBoundVariable' };
    }
    default:
      throw appErr('INVALID_PARAM', `未知变量动作: ${p.action}`);
  }
}

// ---- styles -----------------------------------------------------------------
function cloneArrayField(value, name) {
  if (!Array.isArray(value)) throw appErr('INVALID_PARAM', `${name} 必须是数组`);
  return plain(value);
}
function validateEffects(effects) {
  if (!Array.isArray(effects)) throw appErr('INVALID_PARAM', 'props.effects 必须是数组');
  if (effects.length > 32) throw appErr('INVALID_PARAM', 'props.effects 数量超过 32');
  return effects.map(effect => {
    if (!isPlainObject(effect)) throw appErr('INVALID_PARAM', 'props.effects 元素必须是普通对象');
    if (!EFFECT_TYPES.includes(effect.type)) {
      throw appErr('INVALID_PARAM', `props.effects.type 必须是 ${EFFECT_TYPES.join('/')}`);
    }
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      if (!isPlainObject(effect.color)) throw appErr('INVALID_PARAM', '阴影 effect 需要 color');
      for (const ch of ['r', 'g', 'b']) {
        if (!isFiniteNum(effect.color[ch], 0, 1)) throw appErr('INVALID_PARAM', `effect.color.${ch} 需在 [0,1]`);
      }
      if (effect.color.a !== undefined && !isFiniteNum(effect.color.a, 0, 1)) throw appErr('INVALID_PARAM', 'effect.color.a 需在 [0,1]');
      if (!isPlainObject(effect.offset) || !isFiniteNum(effect.offset.x, -1e6, 1e6) || !isFiniteNum(effect.offset.y, -1e6, 1e6)) {
        throw appErr('INVALID_PARAM', '阴影 effect 需要 offset {x,y}');
      }
      if (!isFiniteNum(effect.radius, 0, 1e5)) throw appErr('INVALID_PARAM', 'effect.radius 需在 [0,1e5]');
    } else if (!isFiniteNum(effect.radius, 0, 1e5)) {
      throw appErr('INVALID_PARAM', '模糊 effect 需要 radius ∈ [0,1e5]');
    }
    return plain(effect);
  });
}
function validateLayoutGrids(grids) {
  if (!Array.isArray(grids)) throw appErr('INVALID_PARAM', 'props.layoutGrids 必须是数组');
  if (grids.length > 16) throw appErr('INVALID_PARAM', 'props.layoutGrids 数量超过 16');
  return grids.map(grid => {
    if (!isPlainObject(grid)) throw appErr('INVALID_PARAM', 'props.layoutGrids 元素必须是普通对象');
    if (grid.pattern !== undefined && !GRID_PATTERNS.includes(grid.pattern)) {
      throw appErr('INVALID_PARAM', `layoutGrids.pattern 必须是 ${GRID_PATTERNS.join('/')}`);
    }
    return plain(grid);
  });
}
async function applyTextProps(style, props) {
  if (props.fontName !== undefined) {
    const font = props.fontName;
    if (!isPlainObject(font) || typeof font.family !== 'string' || typeof font.style !== 'string') {
      throw appErr('INVALID_PARAM', 'props.fontName 需要 {family, style}');
    }
    await figma.loadFontAsync({ family: font.family, style: font.style });
    style.fontName = { family: font.family, style: font.style };
  }
  if (props.fontSize !== undefined) style.fontSize = requireNum(props.fontSize, 'props.fontSize', 1, 1000);
  if (props.lineHeight !== undefined) style.lineHeight = { unit: 'PIXELS', value: requireNum(props.lineHeight, 'props.lineHeight', 0, 1e5) };
  if (props.letterSpacing !== undefined) style.letterSpacing = { unit: 'PIXELS', value: requireNum(props.letterSpacing, 'props.letterSpacing', -1e5, 1e5) };
  if (props.textCase !== undefined) {
    if (!TEXT_CASES.includes(props.textCase)) throw appErr('INVALID_PARAM', `props.textCase 必须是 ${TEXT_CASES.join('/')}`);
    style.textCase = props.textCase;
  }
  if (props.textDecoration !== undefined) {
    if (!TEXT_DECORATIONS.includes(props.textDecoration)) throw appErr('INVALID_PARAM', `props.textDecoration 必须是 ${TEXT_DECORATIONS.join('/')}`);
    style.textDecoration = props.textDecoration;
  }
  if (props.paragraphSpacing !== undefined) style.paragraphSpacing = requireNum(props.paragraphSpacing, 'props.paragraphSpacing', 0, 1e5);
}
async function applyStyleProps(style, styleType, props) {
  if (styleType === 'PAINT' && props.paints !== undefined) style.paints = validatePaints(props.paints, 'props.paints');
  if (styleType === 'TEXT') await applyTextProps(style, props);
  if (styleType === 'EFFECT' && props.effects !== undefined) style.effects = validateEffects(props.effects);
  if (styleType === 'GRID' && props.layoutGrids !== undefined) style.layoutGrids = validateLayoutGrids(props.layoutGrids);
}
async function fetchStyleType(styleType) {
  if (!STYLE_TYPES.includes(styleType)) throw appErr('INVALID_PARAM', `styleType 必须是 ${STYLE_TYPES.join('/')}`);
  const getter = STYLE_GETTERS[styleType];
  if (typeof figma[getter] !== 'function') throw appErr('UNSUPPORTED', `figma.${getter} 不可用`);
  return getter;
}
async function fetchStyles(styleType, t) {
  const getter = await fetchStyleType(styleType);
  const styles = await figma[getter]();
  assertTarget(t);
  return styles || [];
}
async function fetchStyle(styleType, styleId, t) {
  requireStr(styleId, 'styleId');
  const styles = await fetchStyles(styleType, t);
  const style = styles.find(s => s.id === styleId);
  if (!style) throw appErr('STYLE_NOT_FOUND', `找不到 ${styleType} 样式: ${styleId}`);
  return style;
}
function styleInfo(style, styleType) {
  const info = {
    id: style.id, name: str(style.name), styleType,
    key: style.key ?? null,
    description: typeof style.description === 'string' ? style.description.slice(0, 2048) : null,
    remote: !!style.remote,
  };
  if (styleType === 'PAINT') {
    if (style.paints !== undefined) info.paints = cloneArrayField(style.paints, 'style.paints');
  } else if (styleType === 'TEXT') {
    for (const key of ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration', 'paragraphSpacing']) {
      if (style[key] !== undefined) info[key] = cloneValue(style[key]);
    }
  } else if (styleType === 'EFFECT') {
    if (style.effects !== undefined) info.effects = cloneArrayField(style.effects, 'style.effects');
  } else if (styleType === 'GRID') {
    if (style.layoutGrids !== undefined) info.layoutGrids = cloneArrayField(style.layoutGrids, 'style.layoutGrids');
  }
  return info;
}

async function handleStyles(p, t) {
  requireEditor();
  onlyKeys(p, ['action', 'id', 'styleType', 'styleId', 'name', 'props']);
  const props = p.props === undefined ? {} : p.props;
  switch (p.action) {
    case 'list': {
      const styles = await fetchStyles(p.styleType, t);
      const items = styles.map(style => styleInfo(style, p.styleType));
      return listEnvelope(items, 200);
    }
    case 'get':
      return styleInfo(await fetchStyle(p.styleType, p.styleId, t), p.styleType);
    case 'create': {
      requireStr(p.name, 'name');
      if (!STYLE_TYPES.includes(p.styleType)) throw appErr('INVALID_PARAM', `styleType 必须是 ${STYLE_TYPES.join('/')}`);
      const creator = STYLE_CREATORS[p.styleType];
      if (typeof figma[creator] !== 'function') throw appErr('UNSUPPORTED', `figma.${creator} 不可用`);
      assertTarget(t);
      markMutation(t);
      const style = figma[creator]();
      style.name = p.name;
      await applyStyleProps(style, p.styleType, props);
      return styleInfo(style, p.styleType);
    }
    case 'update': {
      const style = await fetchStyle(p.styleType, p.styleId, t);
      if (p.name !== undefined) style.name = requireStr(p.name, 'name');
      await applyStyleProps(style, p.styleType, props);
      markMutation(t);
      return styleInfo(style, p.styleType);
    }
    case 'apply': {
      const node = await getNode(p.id, t);
      const style = await fetchStyle(p.styleType, p.styleId, t);
      assertTarget(t);
      const cap = { PAINT: 'Fill', TEXT: 'Text', EFFECT: 'Effect', GRID: 'Grid' }[p.styleType];
      const asyncSetter = node[`set${cap}StyleIdAsync`];
      let appliedVia;
      if (typeof asyncSetter === 'function') {
        await asyncSetter.call(node, style.id);
        appliedVia = `set${cap}StyleIdAsync`;
      } else {
        node[`${cap.toLowerCase()}StyleId`] = style.id;
        appliedVia = `${cap.toLowerCase()}StyleId`;
      }
      markMutation(t, node);
      return { nodeId: node.id, styleId: style.id, styleType: p.styleType, appliedVia };
    }
    case 'delete': {
      const style = await fetchStyle(p.styleType, p.styleId, t);
      markMutation(t);
      style.remove();
      return { styleId: p.styleId, styleType: p.styleType, deleted: true };
    }
    default:
      throw appErr('INVALID_PARAM', `未知样式动作: ${p.action}`);
  }
}

// ---- components -------------------------------------------------------------
async function mainComponentOf(instance) {
  try {
    if (typeof instance.getMainComponentAsync === 'function') return await instance.getMainComponentAsync();
  } catch (e) { /* fall through to the sync property */ }
  try { return instance.mainComponent || null; } catch { return null; }
}

async function handleComponents(p, t) {
  requireEditor();
  onlyKeys(p, ['action', 'id', 'componentId', 'instanceId', 'parentId', 'x', 'y', 'name', 'propertyName',
    'propertyType', 'value', 'defaultValue', 'variantOptions', 'description', 'nodeIds']);
  switch (p.action) {
    case 'list': {
      assertTarget(t);
      if (typeof figma.currentPage.findAll !== 'function') throw appErr('UNSUPPORTED', 'currentPage.findAll 不可用');
      const found = figma.currentPage.findAll(node => COMPONENT_TYPES.includes(node.type)) || [];
      const items = [];
      for (const node of found) {
        const item = { id: node.id, type: node.type, name: str(node.name), key: node.key ?? null };
        if (node.type === 'INSTANCE') {
          const main = await mainComponentOf(node);
          item.componentId = main ? main.id : null;
        }
        if (node.variantProperties !== undefined) item.variantProperties = plain(node.variantProperties);
        items.push(item);
        if (items.length >= 500) break;
      }
      return listEnvelope(items, 500, found.length);
    }
    case 'createFromNode': {
      const node = await getNode(p.id, t);
      if (['COMPONENT', 'COMPONENT_SET'].includes(node.type)) {
        throw appErr('INVALID_TARGET', '组件/组件集不能再转为组件');
      }
      if (typeof figma.createComponentFromNode !== 'function') throw appErr('UNSUPPORTED', 'figma.createComponentFromNode 不可用');
      assertTarget(t);
      markMutation(t, node);
      const component = figma.createComponentFromNode(node);
      markMutation(t, component);
      return { componentId: component.id, name: str(component.name), childId: node.id };
    }
    case 'createInstance': {
      const component = await getNode(p.componentId, t);
      if (component.type !== 'COMPONENT') throw appErr('INVALID_TARGET', 'componentId 必须是 COMPONENT 节点');
      if (typeof component.createInstance !== 'function') throw appErr('UNSUPPORTED', 'component.createInstance 不可用');
      assertTarget(t);
      const instance = component.createInstance();
      if (p.x !== undefined) instance.x = requireNum(p.x, 'x', -1e6, 1e6);
      if (p.y !== undefined) instance.y = requireNum(p.y, 'y', -1e6, 1e6);
      let parent = figma.currentPage;
      if (p.parentId !== undefined) {
        parent = p.parentId === figma.currentPage.id ? figma.currentPage : await getNode(p.parentId, t);
        if (!['PAGE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'SECTION'].includes(parent.type)) {
          throw appErr('INVALID_TARGET', 'parentId 必须是容器节点');
        }
      }
      parent.appendChild(instance);
      markMutation(t, instance);
      return { id: instance.id, componentId: component.id, parentId: parent.id };
    }
    case 'combineAsVariants': {
      const nodeIds = p.nodeIds;
      if (!Array.isArray(nodeIds) || nodeIds.length < 2 || nodeIds.length > 64) {
        throw appErr('INVALID_PARAM', 'nodeIds 必须是 2..64 个节点 id（当前共享注册表暂未开放该字段）');
      }
      const nodes = [];
      for (const nodeId of nodeIds) {
        const node = await getNode(nodeId, t);
        if (node.type !== 'COMPONENT') throw appErr('INVALID_TARGET', `combineAsVariants 仅支持 COMPONENT 节点: ${nodeId}`);
        nodes.push(node);
      }
      if (typeof figma.combineAsVariants !== 'function') throw appErr('UNSUPPORTED', 'figma.combineAsVariants 不可用');
      assertTarget(t);
      markMutation(t, nodes[0]);
      const set = figma.combineAsVariants(nodes, figma.currentPage);
      markMutation(t, set);
      return { componentSetId: set.id, memberIds: nodes.map(node => node.id) };
    }
    case 'swap': {
      const instance = await getNode(p.instanceId, t);
      if (instance.type !== 'INSTANCE') throw appErr('INVALID_TARGET', 'instanceId 必须是 INSTANCE 节点');
      const component = await getNode(p.componentId, t);
      if (component.type !== 'COMPONENT') throw appErr('INVALID_TARGET', 'componentId 必须是 COMPONENT 节点');
      if (typeof instance.swapComponent !== 'function') throw appErr('UNSUPPORTED', 'instance.swapComponent 不可用');
      markMutation(t, instance);
      instance.swapComponent(component);
      return { id: instance.id, componentId: component.id };
    }
    case 'detach': {
      const instance = await getNode(p.instanceId, t);
      if (instance.type !== 'INSTANCE') throw appErr('INVALID_TARGET', 'instanceId 必须是 INSTANCE 节点');
      if (typeof instance.detachInstance !== 'function') throw appErr('UNSUPPORTED', 'instance.detachInstance 不可用');
      assertTarget(t);
      const frame = instance.detachInstance();
      markMutation(t, frame);
      t.affected.push(instance.id);
      return { id: frame.id, type: frame.type, fromInstanceId: instance.id };
    }
    case 'getInstanceInfo': {
      const instance = await getNode(p.instanceId, t);
      if (instance.type !== 'INSTANCE') throw appErr('INVALID_TARGET', 'instanceId 必须是 INSTANCE 节点');
      const main = await mainComponentOf(instance);
      const info = {
        id: instance.id,
        componentId: main ? main.id : null,
        componentKey: main && main.key !== undefined ? main.key : null,
        componentProperties: plain(instance.componentProperties || {}),
      };
      if (instance.variantProperties !== undefined) info.variantProperties = plain(instance.variantProperties);
      return info;
    }
    case 'setInstanceProperty': {
      const instance = await getNode(p.instanceId, t);
      if (instance.type !== 'INSTANCE') throw appErr('INVALID_TARGET', 'instanceId 必须是 INSTANCE 节点');
      requireStr(p.propertyName, 'propertyName');
      if (!hasOwn(p, 'value')) throw appErr('INVALID_PARAM', 'value 必填');
      if (typeof instance.setProperties !== 'function') throw appErr('UNSUPPORTED', 'instance.setProperties 不可用');
      markMutation(t, instance);
      instance.setProperties({ [p.propertyName]: p.value });
      return { id: instance.id, propertyName: p.propertyName, value: p.value === undefined ? null : p.value };
    }
    case 'addComponentProperty': {
      const component = await getNode(p.componentId, t);
      if (!['COMPONENT', 'COMPONENT_SET'].includes(component.type)) {
        throw appErr('INVALID_TARGET', 'componentId 必须是 COMPONENT 或 COMPONENT_SET 节点');
      }
      requireStr(p.propertyName, 'propertyName');
      if (!PROPERTY_TYPES.includes(p.propertyType)) throw appErr('INVALID_PARAM', `propertyType 必须是 ${PROPERTY_TYPES.join('/')}`);
      if (!hasOwn(p, 'defaultValue')) throw appErr('INVALID_PARAM', 'defaultValue 必填');
      if (p.propertyType === 'BOOLEAN') requireBool(p.defaultValue, 'defaultValue');
      else if (typeof p.defaultValue !== 'string') throw appErr('INVALID_PARAM', `${p.propertyType} 属性的 defaultValue 必须是字符串`);
      if (typeof component.addComponentProperty !== 'function') throw appErr('UNSUPPORTED', 'component.addComponentProperty 不可用');
      markMutation(t, component);
      const propertyName = component.addComponentProperty(p.propertyName, p.propertyType, p.defaultValue);
      return { componentId: component.id, propertyName, propertyType: p.propertyType, defaultValue: p.defaultValue };
    }
    case 'editComponentProperty': {
      const component = await getNode(p.componentId, t);
      if (!['COMPONENT', 'COMPONENT_SET'].includes(component.type)) {
        throw appErr('INVALID_TARGET', 'componentId 必须是 COMPONENT 或 COMPONENT_SET 节点');
      }
      requireStr(p.propertyName, 'propertyName');
      const patch = {};
      if (p.name !== undefined) patch.name = requireStr(p.name, 'name');
      if (hasOwn(p, 'defaultValue') && p.defaultValue !== undefined) {
        if (typeof p.defaultValue !== 'boolean' && typeof p.defaultValue !== 'string') {
          throw appErr('INVALID_PARAM', 'defaultValue 必须是布尔值或字符串');
        }
        patch.defaultValue = p.defaultValue;
      }
      if (p.description !== undefined) patch.description = String(p.description);
      if (Object.keys(patch).length === 0) throw appErr('INVALID_PARAM', 'editComponentProperty 需要 name/defaultValue/description 之一');
      if (typeof component.editComponentProperty !== 'function') throw appErr('UNSUPPORTED', 'component.editComponentProperty 不可用');
      markMutation(t, component);
      const propertyName = component.editComponentProperty(p.propertyName, patch);
      return { componentId: component.id, propertyName, ...patch };
    }
    case 'deleteComponentProperty': {
      const component = await getNode(p.componentId, t);
      if (!['COMPONENT', 'COMPONENT_SET'].includes(component.type)) {
        throw appErr('INVALID_TARGET', 'componentId 必须是 COMPONENT 或 COMPONENT_SET 节点');
      }
      requireStr(p.propertyName, 'propertyName');
      if (typeof component.deleteComponentProperty !== 'function') throw appErr('UNSUPPORTED', 'component.deleteComponentProperty 不可用');
      markMutation(t, component);
      component.deleteComponentProperty(p.propertyName);
      return { componentId: component.id, propertyName: p.propertyName, deleted: true };
    }
    default:
      throw appErr('INVALID_PARAM', `未知组件动作: ${p.action}`);
  }
}

// ---- libraries --------------------------------------------------------------
function teamLibraryApi() {
  const library = figma.teamLibrary;
  if (!library || typeof library !== 'object') {
    throw appErr('UNSUPPORTED', 'figma.teamLibrary 不可用：manifest permissions 需声明 "teamlibrary"');
  }
  return library;
}

async function handleLibraries(p, t) {
  requireEditor();
  onlyKeys(p, ['action', 'collectionKey', 'variableKey', 'componentKey', 'styleKey']);
  switch (p.action) {
    case 'listCollections': {
      const library = teamLibraryApi();
      if (typeof library.getAvailableLibraryVariableCollectionsAsync !== 'function') {
        throw appErr('UNSUPPORTED', 'figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync 不可用');
      }
      let collections;
      try { collections = await library.getAvailableLibraryVariableCollectionsAsync(); }
      catch (e) { wrapApiError(e, 'getAvailableLibraryVariableCollectionsAsync'); }
      assertTarget(t);
      const items = (collections || []).map(collection => ({
        id: collection.id ?? null, name: str(collection.name), key: collection.key ?? null,
      }));
      return listEnvelope(items, 100);
    }
    case 'listVariables': {
      requireStr(p.collectionKey, 'collectionKey');
      const library = teamLibraryApi();
      if (typeof library.getVariablesInLibraryCollectionAsync !== 'function') {
        throw appErr('UNSUPPORTED', 'figma.teamLibrary.getVariablesInLibraryCollectionAsync 不可用');
      }
      let variables;
      try { variables = await library.getVariablesInLibraryCollectionAsync(p.collectionKey); }
      catch (e) { wrapApiError(e, 'getVariablesInLibraryCollectionAsync'); }
      assertTarget(t);
      const items = (variables || []).map(variable => ({
        id: variable.id ?? null,
        variableId: variable.variableId ?? null,
        key: variable.key ?? null,
        name: str(variable.name),
        resolvedType: variable.resolvedType ?? null,
        ...(typeof variable.description === 'string' ? { description: variable.description.slice(0, 2048) } : {}),
      }));
      return listEnvelope(items, 200);
    }
    case 'importVariable': {
      requireStr(p.variableKey, 'variableKey');
      if (typeof figma.variables.importVariableByKeyAsync !== 'function') {
        throw appErr('UNSUPPORTED', 'figma.variables.importVariableByKeyAsync 不可用');
      }
      let variable;
      try { variable = await figma.variables.importVariableByKeyAsync(p.variableKey); }
      catch (e) { wrapApiError(e, 'importVariableByKeyAsync'); }
      assertTarget(t);
      markMutation(t);
      return { ...variableInfo(variable), imported: true };
    }
    case 'importComponent': {
      requireStr(p.componentKey, 'componentKey');
      if (typeof figma.importComponentByKeyAsync !== 'function') throw appErr('UNSUPPORTED', 'figma.importComponentByKeyAsync 不可用');
      let component;
      try { component = await figma.importComponentByKeyAsync(p.componentKey); }
      catch (e) { wrapApiError(e, 'importComponentByKeyAsync'); }
      assertTarget(t);
      markMutation(t);
      return { id: component.id, type: component.type, name: str(component.name), key: component.key ?? null, imported: true };
    }
    case 'importStyle': {
      requireStr(p.styleKey, 'styleKey');
      if (typeof figma.importStyleByKeyAsync !== 'function') throw appErr('UNSUPPORTED', 'figma.importStyleByKeyAsync 不可用');
      let style;
      try { style = await figma.importStyleByKeyAsync(p.styleKey); }
      catch (e) { wrapApiError(e, 'importStyleByKeyAsync'); }
      assertTarget(t);
      markMutation(t);
      const styleType = STYLE_TYPES.includes(style.type) ? style.type : 'PAINT';
      return { ...styleInfo(style, styleType), imported: true };
    }
    default:
      throw appErr('INVALID_PARAM', `未知库动作: ${p.action}`);
  }
}

export const handlers = {
  variables: handleVariables,
  styles: handleStyles,
  components: handleComponents,
  libraries: handleLibraries,
};
