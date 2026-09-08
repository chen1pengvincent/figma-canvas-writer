// Vector domain: polygons, vector paths, boolean operations and shape
// parameters. Inputs are fully validated (path data prefix, network indices,
// node-type restrictions) before any node is touched.
import { appErr, isFiniteNum, isPlainObject, hasOwn, onlyKeys, cloneValue, buildNodeInfo } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'vector',
  actions: ['createPolygon', 'createVectorPaths', 'boolean', 'setShapeParams', 'setVectorNetwork'],
  preconditions: [],
  notes: [
    '布尔运算走官方 figma.union/subtract/intersect/exclude（nodes, parent 签名）；SUBTRACT 语义为 nodes[0] 减其余，顺序透传',
    'vectorPaths 的 data 必须是以 M/m 开头的非空 SVG 路径字符串；vectorNetwork 赋值前校验顶点/线段索引',
    'pointCount 仅 POLYGON/STAR，innerRadius 仅 STAR；结果为可编辑节点，回读节点信息',
  ],
};

const WINDING_RULES = ['NONZERO', 'EVENODD', 'NONE'];
const BOOLEAN_FNS = { UNION: 'union', SUBTRACT: 'subtract', INTERSECT: 'intersect', EXCLUDE: 'exclude' };

function requireFigmaEditor() {
  if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '矢量命令仅在 Figma Design 编辑器可用');
}

function applyFailure(e, applied, node) {
  const failure = appErr('PROP_APPLY_FAILED', e.message);
  failure.state = applied.length ? 'partial' : 'not_started';
  failure.details = { appliedProperties: applied };
  if (applied.length && node && !node.removed && node.parent) failure.details.readBack = buildNodeInfo(node);
  return failure;
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1) throw appErr('INVALID_PARAM', 'paths 必须是 1..64 个路径对象');
  if (paths.length > 64) throw appErr('INVALID_PARAM', 'paths 数量超过 64');
  return paths.map((raw, i) => {
    const label = `paths[${i}]`;
    if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', `${label} 必须是普通对象`);
    if (!WINDING_RULES.includes(raw.windingRule)) throw appErr('INVALID_PARAM', `${label}.windingRule 非法`);
    if (typeof raw.data !== 'string' || !raw.data.length || !/^[Mm]/.test(raw.data)) {
      throw appErr('INVALID_PARAM', `${label}.data 必须是以 M 开头的非空 SVG 路径字符串`);
    }
    return { windingRule: raw.windingRule, data: raw.data };
  });
}

async function handleCreatePolygon(p, t) {
  onlyKeys(p, ['action', 'pointCount', 'polygonWidth', 'polygonHeight', 'x', 'y', 'cornerRadius', 'name', 'parentId']);
  const parent = p.parentId === undefined ? null : await getNode(p.parentId, t);
  assertTarget(t);
  if (typeof figma.createPolygon !== 'function') throw appErr('UNSUPPORTED', 'figma.createPolygon 不可用');
  let node;
  try {
    markMutation(t);
    node = figma.createPolygon();
    if (!t.affected.includes(node.id)) t.affected.push(node.id);
    if (parent) parent.appendChild(node);
    if (hasOwn(p, 'pointCount')) {
      markMutation(t, node);
      node.pointCount = p.pointCount;
    }
    if (hasOwn(p, 'polygonWidth') || hasOwn(p, 'polygonHeight')) {
      markMutation(t, node);
      node.resize(hasOwn(p, 'polygonWidth') ? p.polygonWidth : node.width,
        hasOwn(p, 'polygonHeight') ? p.polygonHeight : node.height);
    }
    for (const k of ['x', 'y', 'cornerRadius']) {
      if (!hasOwn(p, k)) continue;
      markMutation(t, node);
      node[k] = p[k];
    }
    if (p.name !== undefined) {
      markMutation(t, node);
      node.name = p.name;
    }
    const out = buildNodeInfo(node);
    if ('pointCount' in node) out.pointCount = cloneValue(node.pointCount);
    return out;
  } catch (e) {
    if (node) {
      try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
      catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
    } else e.state = 'unknown';
    throw e;
  }
}

async function handleCreateVectorPaths(p, t) {
  onlyKeys(p, ['action', 'paths', 'x', 'y', 'name', 'parentId']);
  const paths = validatePaths(p.paths);
  const parent = p.parentId === undefined ? null : await getNode(p.parentId, t);
  assertTarget(t);
  if (typeof figma.createVector !== 'function') throw appErr('UNSUPPORTED', 'figma.createVector 不可用');
  let node;
  try {
    markMutation(t);
    node = figma.createVector();
    if (!t.affected.includes(node.id)) t.affected.push(node.id);
    if (parent) parent.appendChild(node);
    for (const k of ['x', 'y']) {
      if (!hasOwn(p, k)) continue;
      markMutation(t, node);
      node[k] = p[k];
    }
    if (p.name !== undefined) {
      markMutation(t, node);
      node.name = p.name;
    }
    markMutation(t, node);
    node.vectorPaths = paths;
    return { ...buildNodeInfo(node), vectorPaths: cloneValue(node.vectorPaths) };
  } catch (e) {
    if (node) {
      try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
      catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
    } else e.state = 'unknown';
    throw e;
  }
}

async function handleBoolean(p, t) {
  onlyKeys(p, ['action', 'nodeIds', 'operation', 'parentId']);
  if (!Array.isArray(p.nodeIds) || p.nodeIds.length !== 2) {
    throw appErr('INVALID_PARAM', 'nodeIds 必须恰好是两个节点 id');
  }
  if (typeof p.operation !== 'string' || !BOOLEAN_FNS[p.operation]) {
    throw appErr('INVALID_PARAM', 'operation 必须是 UNION/SUBTRACT/INTERSECT/EXCLUDE');
  }
  const fn = BOOLEAN_FNS[p.operation];
  if (typeof figma[fn] !== 'function') throw appErr('UNSUPPORTED', `figma.${fn} 不可用`);
  const a = await getNode(p.nodeIds[0], t);
  const b = await getNode(p.nodeIds[1], t);
  assertTarget(t);
  const parent = p.parentId === undefined ? (a.parent || figma.currentPage) : await getNode(p.parentId, t);
  const bool = figma[fn]([a, b], parent);
  markMutation(t, bool);
  markMutation(t, a);
  markMutation(t, b);
  return buildNodeInfo(bool);
}

async function handleSetShapeParams(p, t) {
  onlyKeys(p, ['action', 'id', 'pointCount', 'innerRadius', 'cornerRadius']);
  const keys = ['pointCount', 'innerRadius', 'cornerRadius'].filter(k => hasOwn(p, k));
  if (!keys.length) throw appErr('INVALID_PARAM', 'pointCount/innerRadius/cornerRadius 至少提供一项');
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (hasOwn(p, 'pointCount')) {
    if (node.type !== 'POLYGON' && node.type !== 'STAR') throw appErr('INVALID_PARAM', 'pointCount 仅支持 POLYGON/STAR');
    if (!Number.isInteger(p.pointCount) || p.pointCount < 3 || p.pointCount > 60) {
      throw appErr('INVALID_PARAM', 'pointCount 需在 [3,60]');
    }
  }
  if (hasOwn(p, 'innerRadius')) {
    if (node.type !== 'STAR') throw appErr('INVALID_PARAM', 'innerRadius 仅支持 STAR');
    if (!isFiniteNum(p.innerRadius, 0, 1)) throw appErr('INVALID_PARAM', 'innerRadius 需在 [0,1]');
  }
  if (hasOwn(p, 'cornerRadius') && !('cornerRadius' in node)) {
    throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 cornerRadius`);
  }
  const applied = [];
  try {
    for (const k of keys) {
      node[k] = p[k];
      markMutation(t, node);
      applied.push(k);
    }
  } catch (e) {
    throw applyFailure(e, applied, node);
  }
  const out = buildNodeInfo(node);
  if ('pointCount' in node) out.pointCount = cloneValue(node.pointCount);
  if ('innerRadius' in node) out.innerRadius = cloneValue(node.innerRadius);
  return out;
}

function validateVectorNetwork(network) {
  if (!isPlainObject(network)) throw appErr('INVALID_PARAM', 'vectorNetwork 必须是普通对象');
  if (!Array.isArray(network.vertices) || network.vertices.length < 2) {
    throw appErr('INVALID_PARAM', 'vectorNetwork.vertices 必须是至少 2 个顶点的数组');
  }
  for (const vertex of network.vertices) {
    if (!isPlainObject(vertex)) throw appErr('INVALID_PARAM', 'vectorNetwork.vertices 元素必须是普通对象');
  }
  if (!Array.isArray(network.segments)) throw appErr('INVALID_PARAM', 'vectorNetwork.segments 必须是数组');
  const count = network.vertices.length;
  network.segments.forEach((segment, i) => {
    const label = `vectorNetwork.segments[${i}]`;
    if (!isPlainObject(segment)) throw appErr('INVALID_PARAM', `${label} 必须是普通对象`);
    for (const k of ['start', 'end']) {
      if (!Number.isInteger(segment[k]) || segment[k] < 0 || segment[k] >= count) {
        throw appErr('INVALID_PARAM', `${label}.${k} 必须是顶点索引`);
      }
    }
  });
  if (network.regions !== undefined && !Array.isArray(network.regions)) {
    throw appErr('INVALID_PARAM', 'vectorNetwork.regions 必须是数组');
  }
  return network;
}

async function handleSetVectorNetwork(p, t) {
  onlyKeys(p, ['action', 'id', 'vectorNetwork']);
  const network = JSON.parse(JSON.stringify(validateVectorNetwork(p.vectorNetwork)));
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (node.type !== 'VECTOR') throw appErr('INVALID_TARGET', '目标不是 VECTOR 节点');
  if (!('vectorNetwork' in node)) throw appErr('UNSUPPORTED', `${node.type} 不支持 vectorNetwork`);
  markMutation(t, node);
  try {
    node.vectorNetwork = network;
  } catch (e) {
    throw applyFailure(e, [], node);
  }
  return { ...buildNodeInfo(node), vectorNetwork: cloneValue(node.vectorNetwork) };
}

export const handlers = {
  vector: async (p, t) => {
    requireFigmaEditor();
    if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    switch (p.action) {
      case 'createPolygon': return handleCreatePolygon(p, t);
      case 'createVectorPaths': return handleCreateVectorPaths(p, t);
      case 'boolean': return handleBoolean(p, t);
      case 'setShapeParams': return handleSetShapeParams(p, t);
      case 'setVectorNetwork': return handleSetVectorNetwork(p, t);
      default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
    }
  },
};
