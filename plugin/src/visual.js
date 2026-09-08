// Visual domain: effects, blend mode, clipping, masking, layout grids,
// stroke detail and per-corner radii. Lists and structures are validated in
// full before any assignment; side-edge strokes and corner radii are only
// settable on node types that actually expose those properties.
import { appErr, isFiniteNum, isPlainObject, hasOwn, onlyKeys, cloneValue, buildNodeInfo, pageOfNode } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'visual',
  actions: ['setEffects', 'setBlend', 'setClip', 'setMask', 'setGrids', 'setStrokeDetail', 'setCornerRadii'],
  preconditions: [],
  notes: [
    'effects 与 layoutGrids 先整体校验再一次性赋值；blendMode 采用运行时白名单（共享注册表该字段为自由字符串）',
    '分边描边（strokeTop/Bottom/Left/RightWeight）与分角圆角仅在节点拥有对应属性时可设，否则如实报错',
    'setMask 的 maskType 仅在节点支持时赋值；isMask=true 要求节点已有父节点',
  ],
};

const EFFECT_TYPES = new Set(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR', 'NOISE', 'TEXTURE', 'SHADER']);
const SHADOW_TYPES = new Set(['DROP_SHADOW', 'INNER_SHADOW']);
const BLUR_TYPES = new Set(['LAYER_BLUR', 'BACKGROUND_BLUR']);
const BLEND_MODES = new Set(['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN',
  'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION',
  'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']);
const GRID_TYPES = ['GRID_COLUMNS', 'GRID_ROWS', 'GRID_UNIFORM'];
const GRID_ALIGNMENTS = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];
const STROKE_ENUMS = {
  strokeAlign: ['INSIDE', 'OUTSIDE', 'CENTER'],
  strokeCap: ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'],
  strokeJoin: ['MITER', 'BEVEL', 'ROUND'],
};
const SIDE_WEIGHT_KEYS = ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight'];
const STROKE_KEYS = ['strokeAlign', 'strokeCap', 'strokeJoin', 'strokeMiterLimit', 'dashPattern', ...SIDE_WEIGHT_KEYS];
const CORNER_KEYS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];

function requireFigmaEditor() {
  if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '视觉命令仅在 Figma Design 编辑器可用');
}

function requireProps(p, keys) {
  const props = p.props;
  if (!isPlainObject(props)) throw appErr('INVALID_PARAM', 'props 必须是普通对象');
  onlyKeys(props, keys);
  if (!Object.keys(props).length) throw appErr('INVALID_PARAM', 'props 至少包含一项');
  return props;
}

function applyFailure(e, applied, node) {
  const failure = appErr('PROP_APPLY_FAILED', e.message);
  failure.state = applied.length ? 'partial' : 'not_started';
  failure.details = { appliedProperties: applied };
  if (applied.length && !node.removed && pageOfNode(node) && pageOfNode(node).id === figma.currentPage.id) {
    failure.details.readBack = buildNodeInfo(node);
  }
  return failure;
}

function validateEffects(effects) {
  if (!Array.isArray(effects)) throw appErr('INVALID_PARAM', 'effects 必须是数组');
  if (effects.length > 32) throw appErr('INVALID_PARAM', 'effects 数量超过 32');
  return effects.map((raw, i) => {
    const label = `effects[${i}]`;
    if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', `${label} 必须是普通对象`);
    if (typeof raw.type !== 'string' || !EFFECT_TYPES.has(raw.type)) {
      throw appErr('INVALID_PARAM', `${label}.type 非法`);
    }
    if (SHADOW_TYPES.has(raw.type)) {
      for (const k of ['color', 'offset', 'radius', 'visible', 'blendMode']) {
        if (!(k in raw)) throw appErr('INVALID_PARAM', `${label} 缺少 ${k}`);
      }
      const color = raw.color;
      if (!isPlainObject(color)) throw appErr('INVALID_PARAM', `${label}.color 必须是 {r,g,b,a} 对象`);
      for (const ch of ['r', 'g', 'b', 'a']) {
        if (!isFiniteNum(color[ch], 0, 1)) throw appErr('INVALID_PARAM', `${label}.color.${ch} 需在 [0,1]`);
      }
      const offset = raw.offset;
      if (!isPlainObject(offset) || !isFiniteNum(offset.x, -1e6, 1e6) || !isFiniteNum(offset.y, -1e6, 1e6)) {
        throw appErr('INVALID_PARAM', `${label}.offset 必须是 {x,y}`);
      }
      if (!isFiniteNum(raw.radius, 0, 1e5)) throw appErr('INVALID_PARAM', `${label}.radius 需在 [0,1e5]`);
      if (typeof raw.visible !== 'boolean') throw appErr('INVALID_PARAM', `${label}.visible 必须是布尔值`);
      if (typeof raw.blendMode !== 'string' || !raw.blendMode) throw appErr('INVALID_PARAM', `${label}.blendMode 必须是字符串`);
    }
    if (BLUR_TYPES.has(raw.type)) {
      if (!isFiniteNum(raw.radius, 0, 1e5)) throw appErr('INVALID_PARAM', `${label}.radius 需在 [0,1e5]`);
      if (typeof raw.visible !== 'boolean') throw appErr('INVALID_PARAM', `${label} 缺少 visible`);
    }
    if (raw.type === 'NOISE') {
      // Noise/Texture/Shader effects: validate the well-known fields, pass the
      // rest through as opaque JSON (no prototype keys survive sanitization).
      for (const k of ['noiseSize', 'density']) {
        if (k in raw && !isFiniteNum(raw[k], 0, 1)) throw appErr('INVALID_PARAM', `${label}.${k} 需在 [0,1]`);
      }
    }
    if (raw.type === 'TEXTURE' && 'noiseSize' in raw && !isFiniteNum(raw.noiseSize, 0, 1)) {
      throw appErr('INVALID_PARAM', `${label}.noiseSize 需在 [0,1]`);
    }
    if (raw.type === 'SHADER' && 'properties' in raw && !isPlainObject(raw.properties)) {
      throw appErr('INVALID_PARAM', `${label}.properties 必须是对象`);
    }
    return JSON.parse(JSON.stringify(raw));
  });
}

function validateGrids(grids) {
  if (!Array.isArray(grids)) throw appErr('INVALID_PARAM', 'layoutGrids 必须是数组');
  if (grids.length > 16) throw appErr('INVALID_PARAM', 'layoutGrids 数量超过 16');
  return grids.map((raw, i) => {
    const label = `layoutGrids[${i}]`;
    if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', `${label} 必须是普通对象`);
    if (!GRID_TYPES.includes(raw.type)) throw appErr('INVALID_PARAM', `${label}.type 非法`);
    const allowed = raw.type === 'GRID_UNIFORM'
      ? ['type', 'sectionSize']
      : ['type', 'count', 'sectionSize', 'gutterSize', 'alignment'];
    for (const k of Object.keys(raw)) {
      if (!allowed.includes(k)) throw appErr('INVALID_PARAM', `${label} 不支持 ${k}`);
    }
    if (raw.type === 'GRID_UNIFORM') {
      if (!isFiniteNum(raw.sectionSize, 0, 1e5)) throw appErr('INVALID_PARAM', `${label}.sectionSize 需在 [0,1e5]`);
      return { type: raw.type, sectionSize: raw.sectionSize };
    }
    const out = { type: raw.type };
    const hasCount = raw.count !== undefined;
    const hasSection = raw.sectionSize !== undefined;
    if (!hasCount && !hasSection) throw appErr('INVALID_PARAM', `${label} 需要 count 或 sectionSize`);
    if (hasCount) {
      if (!Number.isInteger(raw.count) || raw.count < 1 || raw.count > 100) {
        throw appErr('INVALID_PARAM', `${label}.count 需在 [1,100]`);
      }
      out.count = raw.count;
    }
    if (hasSection) {
      if (!isFiniteNum(raw.sectionSize, 0, 1e5)) throw appErr('INVALID_PARAM', `${label}.sectionSize 需在 [0,1e5]`);
      out.sectionSize = raw.sectionSize;
    }
    if (raw.gutterSize !== undefined) {
      if (!isFiniteNum(raw.gutterSize, 0, 1e5)) throw appErr('INVALID_PARAM', `${label}.gutterSize 需在 [0,1e5]`);
      out.gutterSize = raw.gutterSize;
    }
    if (raw.alignment !== undefined) {
      if (!GRID_ALIGNMENTS.includes(raw.alignment)) throw appErr('INVALID_PARAM', `${label}.alignment 非法`);
      out.alignment = raw.alignment;
    }
    return out;
  });
}

async function handleSetEffects(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const effects = validateEffects(requireProps(p, ['effects']).effects);
  const node = await getNode(p.id, t);
  assertTarget(t);
  markMutation(t, node);
  try {
    node.effects = effects;
  } catch (e) {
    throw applyFailure(e, [], node);
  }
  return { ...buildNodeInfo(node), effects: cloneValue(node.effects) };
}

async function handleSetBlend(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, ['blendMode']);
  if (typeof props.blendMode !== 'string' || !BLEND_MODES.has(props.blendMode)) {
    throw appErr('INVALID_PARAM', 'blendMode 非法');
  }
  const node = await getNode(p.id, t);
  assertTarget(t);
  markMutation(t, node);
  try {
    node.blendMode = props.blendMode;
  } catch (e) {
    throw applyFailure(e, [], node);
  }
  return { ...buildNodeInfo(node), blendMode: node.blendMode };
}

async function handleSetClip(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, ['clipsContent']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (!('clipsContent' in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 clipsContent`);
  markMutation(t, node);
  try {
    node.clipsContent = props.clipsContent;
  } catch (e) {
    throw applyFailure(e, [], node);
  }
  return { ...buildNodeInfo(node), clipsContent: node.clipsContent };
}

async function handleSetMask(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, ['isMask', 'maskType']);
  if (typeof props.isMask !== 'boolean') throw appErr('INVALID_PARAM', 'isMask 必须是布尔值');
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (props.isMask && !node.parent) throw appErr('INVALID_PARAM', 'isMask=true 需要节点已有父节点');
  const steps = [['isMask', props.isMask]];
  if (props.maskType !== undefined && 'maskType' in node) steps.push(['maskType', props.maskType]);
  markMutation(t, node);
  const applied = [];
  try {
    for (const [k, v] of steps) {
      node[k] = v;
      applied.push(k);
    }
  } catch (e) {
    throw applyFailure(e, applied, node);
  }
  const out = { ...buildNodeInfo(node), isMask: node.isMask };
  if ('maskType' in node) out.maskType = cloneValue(node.maskType);
  return out;
}

async function handleSetGrids(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const grids = validateGrids(requireProps(p, ['layoutGrids']).layoutGrids);
  const node = await getNode(p.id, t);
  assertTarget(t);
  markMutation(t, node);
  try {
    node.layoutGrids = grids;
  } catch (e) {
    throw applyFailure(e, [], node);
  }
  return { ...buildNodeInfo(node), layoutGrids: cloneValue(node.layoutGrids) };
}

async function handleSetStrokeDetail(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, STROKE_KEYS);
  const node = await getNode(p.id, t);
  assertTarget(t);
  const order = STROKE_KEYS.filter(k => hasOwn(props, k));
  for (const k of order) {
    if (SIDE_WEIGHT_KEYS.includes(k)) {
      if (!(k in node)) throw appErr('INVALID_PARAM', '该节点类型不支持分边描边');
      if (!isFiniteNum(props[k], 0, 1e5)) throw appErr('INVALID_PARAM', `${k} 需在 [0,1e5]`);
    } else if (!(k in node)) {
      throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${k}`);
    }
  }
  for (const [k, allowed] of Object.entries(STROKE_ENUMS)) {
    if (hasOwn(props, k) && !allowed.includes(props[k])) throw appErr('INVALID_PARAM', `${k} 非法`);
  }
  if (hasOwn(props, 'strokeMiterLimit') && !isFiniteNum(props.strokeMiterLimit, 0, 1000)) {
    throw appErr('INVALID_PARAM', 'strokeMiterLimit 需在 [0,1000]');
  }
  if (hasOwn(props, 'dashPattern')) {
    if (!Array.isArray(props.dashPattern) || props.dashPattern.length > 32) {
      throw appErr('INVALID_PARAM', 'dashPattern 必须是 ≤32 个数字的数组');
    }
    for (const v of props.dashPattern) {
      if (!isFiniteNum(v, 0, 1e5)) throw appErr('INVALID_PARAM', 'dashPattern 元素需在 [0,1e5]');
    }
  }
  markMutation(t, node);
  const applied = [];
  try {
    for (const k of order) {
      node[k] = props[k];
      applied.push(k);
    }
  } catch (e) {
    throw applyFailure(e, applied, node);
  }
  const out = buildNodeInfo(node);
  for (const k of STROKE_KEYS) {
    if (k in node) out[k] = cloneValue(node[k]);
  }
  return out;
}

async function handleSetCornerRadii(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, [...CORNER_KEYS, 'cornerSmoothing']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  const order = CORNER_KEYS.filter(k => hasOwn(props, k));
  for (const k of order) {
    if (!(k in node)) throw appErr('INVALID_PARAM', '该节点类型不支持分角圆角');
    if (!isFiniteNum(props[k], 0, 1e5)) throw appErr('INVALID_PARAM', `${k} 需在 [0,1e5]`);
  }
  if (hasOwn(props, 'cornerSmoothing')) {
    if (!('cornerSmoothing' in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 cornerSmoothing`);
    if (!isFiniteNum(props.cornerSmoothing, 0, 1)) throw appErr('INVALID_PARAM', 'cornerSmoothing 需在 [0,1]');
  }
  const steps = [...order.map(k => [k, props[k]]), ...(hasOwn(props, 'cornerSmoothing') ? [['cornerSmoothing', props.cornerSmoothing]] : [])];
  markMutation(t, node);
  const applied = [];
  try {
    for (const [k, v] of steps) {
      node[k] = v;
      applied.push(k);
    }
  } catch (e) {
    throw applyFailure(e, applied, node);
  }
  const out = buildNodeInfo(node);
  for (const k of [...CORNER_KEYS, 'cornerSmoothing']) {
    if (k in node) out[k] = cloneValue(node[k]);
  }
  return out;
}

export const handlers = {
  visual: async (p, t) => {
    requireFigmaEditor();
    if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    switch (p.action) {
      case 'setEffects': return handleSetEffects(p, t);
      case 'setBlend': return handleSetBlend(p, t);
      case 'setClip': return handleSetClip(p, t);
      case 'setMask': return handleSetMask(p, t);
      case 'setGrids': return handleSetGrids(p, t);
      case 'setStrokeDetail': return handleSetStrokeDetail(p, t);
      case 'setCornerRadii': return handleSetCornerRadii(p, t);
      default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
    }
  },
};
