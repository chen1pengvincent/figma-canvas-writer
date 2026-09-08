// Hierarchy domain: clone, group/ungroup, reparent (local vs absolute
// coordinates) and reorder. Structural writes go through the real figma
// APIs with explicit same-parent and cycle checks before any mutation.
import { appErr, isPlainObject, onlyKeys, buildNodeInfo } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'hierarchy',
  actions: ['clone', 'group', 'ungroup', 'reparent', 'reorder'],
  preconditions: [],
  notes: [
    'clone 依赖 node.clone()（真机复制到同父并保持原位，可叠加位置偏移）',
    'reparent 的 keepAbsolute 依赖 absoluteTransform（真机可用；运行时缺失时如实返回 UNSUPPORTED）',
    'group 要求全部节点位于同一父节点下；ungroup 优先 figma.ungroup，缺失时手动上移子节点后移除组',
  ],
};

function requireFigmaEditor() {
  if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '层级命令仅在 Figma Design 编辑器可用');
}

function translationOf(m) {
  if (!Array.isArray(m) || !Array.isArray(m[0]) || !Array.isArray(m[1])) return null;
  if (!Number.isFinite(m[0][2]) || !Number.isFinite(m[1][2])) return null;
  return [m[0][2], m[1][2]];
}

async function handleClone(p, t) {
  onlyKeys(p, ['action', 'id', 'name']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (typeof node.clone !== 'function') throw appErr('UNSUPPORTED', `${node.type} 不支持 clone`);
  markMutation(t, node);
  const clone = node.clone();
  if (!clone.parent && node.parent && typeof node.parent.appendChild === 'function') node.parent.appendChild(clone);
  if (p.name !== undefined) clone.name = p.name;
  markMutation(t, clone);
  return buildNodeInfo(clone);
}

async function handleGroup(p, t) {
  onlyKeys(p, ['action', 'nodeIds', 'name']);
  if (!Array.isArray(p.nodeIds) || p.nodeIds.length < 1 || p.nodeIds.length > 100) {
    throw appErr('INVALID_PARAM', 'nodeIds 必须是 1..100 个节点 id');
  }
  const nodes = [];
  for (const id of p.nodeIds) nodes.push(await getNode(id, t));
  assertTarget(t);
  const parent = nodes[0].parent;
  if (!parent) throw appErr('INVALID_TARGET', '必须位于同一父节点下');
  for (const node of nodes) {
    if (!node.parent || node.parent.id !== parent.id) throw appErr('INVALID_TARGET', '必须位于同一父节点下');
  }
  if (typeof figma.group !== 'function') throw appErr('UNSUPPORTED', 'figma.group 不可用');
  const group = figma.group(nodes, parent);
  if (p.name !== undefined) group.name = p.name;
  markMutation(t, group);
  for (const node of nodes) markMutation(t, node);
  return buildNodeInfo(group);
}

async function handleUngroup(p, t) {
  onlyKeys(p, ['action', 'id']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (node.type !== 'GROUP') throw appErr('INVALID_TARGET', '目标不是 GROUP');
  const children = [...(node.children || [])];
  markMutation(t);
  if (!t.affected.includes(node.id)) t.affected.push(node.id);
  if (typeof figma.ungroup === 'function') {
    const moved = figma.ungroup(node);
    const list = Array.isArray(moved) && moved.length ? moved : children;
    for (const child of list) markMutation(t, child);
    return { children: list.map(child => child.id) };
  }
  const parent = node.parent;
  if (!parent || typeof parent.appendChild !== 'function') throw appErr('UNSUPPORTED', '父容器不支持接收子节点');
  for (const child of children) {
    parent.appendChild(child);
    markMutation(t, child);
  }
  node.remove();
  return { children: children.map(child => child.id) };
}

async function handleReparent(p, t) {
  onlyKeys(p, ['action', 'id', 'parentId', 'position']);
  const position = p.position === undefined ? 'keepLocal' : p.position;
  if (position !== 'keepLocal' && position !== 'keepAbsolute') {
    throw appErr('INVALID_PARAM', 'position 必须是 keepLocal 或 keepAbsolute');
  }
  const node = await getNode(p.id, t);
  const parent = await getNode(p.parentId, t, { allowContainer: true });
  assertTarget(t);
  if (parent.type === 'DOCUMENT') throw appErr('INVALID_TARGET', 'parentId 不能是 DOCUMENT');
  for (let cursor = parent; cursor; cursor = cursor.parent) {
    if (cursor.id === node.id) throw appErr('INVALID_TARGET', '拒绝循环层级');
  }
  if (typeof parent.appendChild !== 'function') throw appErr('INVALID_TARGET', 'parentId 不支持子节点');
  if (position === 'keepAbsolute') {
    const nodeTranslation = translationOf(node.absoluteTransform);
    const parentTranslation = translationOf(parent.absoluteTransform);
    if (!nodeTranslation || !parentTranslation) {
      throw appErr('UNSUPPORTED', 'keepAbsolute 需要 absoluteTransform（真机可用）');
    }
    markMutation(t, node);
    parent.appendChild(node);
    node.x = nodeTranslation[0] - parentTranslation[0];
    node.y = nodeTranslation[1] - parentTranslation[1];
  } else {
    markMutation(t, node);
    parent.appendChild(node);
  }
  return buildNodeInfo(node);
}

async function handleReorder(p, t) {
  onlyKeys(p, ['action', 'id', 'index', 'beforeNodeId']);
  const hasIndex = p.index !== undefined;
  const hasBefore = p.beforeNodeId !== undefined;
  if (hasIndex === hasBefore) throw appErr('INVALID_PARAM', 'index 与 beforeNodeId 必须恰好提供一个');
  const node = await getNode(p.id, t);
  assertTarget(t);
  const parent = node.parent;
  if (!parent || typeof parent.insertChild !== 'function') throw appErr('INVALID_TARGET', '目标节点没有可重排的父容器');
  let target;
  if (hasBefore) {
    const before = await getNode(p.beforeNodeId, t);
    const at = parent.children.indexOf(before);
    if (at < 0) throw appErr('INVALID_PARAM', 'beforeNodeId 不在同一父节点下');
    target = at;
  } else {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index > parent.children.length) {
      throw appErr('INVALID_PARAM', 'index 越界');
    }
    target = p.index;
  }
  markMutation(t, node);
  parent.insertChild(target, node);
  return { id: node.id, index: parent.children.indexOf(node) };
}

export const handlers = {
  hierarchy: async (p, t) => {
    requireFigmaEditor();
    if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    switch (p.action) {
      case 'clone': return handleClone(p, t);
      case 'group': return handleGroup(p, t);
      case 'ungroup': return handleUngroup(p, t);
      case 'reparent': return handleReparent(p, t);
      case 'reorder': return handleReorder(p, t);
      default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
    }
  },
};
