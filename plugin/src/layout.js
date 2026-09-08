// Layout domain: auto-layout on containers, layout overrides for direct
// children, layout removal and resize constraints. layoutMode is applied
// first (real Figma requires the direction before spacing/padding) and
// partial-failure semantics mirror edit.js applyProps.
import { appErr, isPlainObject, hasOwn, onlyKeys, cloneValue, buildNodeInfo } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';
import { applyProps } from './edit.js';

export const domainMeta = {
  name: 'layout',
  actions: ['setLayout', 'setChildLayout', 'removeLayout', 'setConstraints'],
  preconditions: [],
  notes: [
    'setLayout 为部分更新：若提供 layoutMode 则先赋值再赋其余键（真实 Figma 需先定方向）；属性存在性与部分失败语义与 edit.js 一致',
    'setChildLayout 仅作用于容器的直接子节点（child.parent.id 必须等于目标 id）',
    'setConstraints 合并节点既有 constraints，未提供的方向沿用原值（缺省 MIN）',
  ],
};

const SET_LAYOUT_KEYS = ['layoutMode', 'primaryAxisAlignItems', 'counterAxisAlignItems',
  'primaryAxisSizingMode', 'counterAxisSizingMode', 'itemSpacing', 'counterAxisSpacing',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'layoutWrap',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
const CHILD_LAYOUT_KEYS = ['layoutAlign', 'layoutGrow', 'layoutPositioning',
  'layoutSizingHorizontal', 'layoutSizingVertical'];
const CONSTRAINT_KEYS = ['horizontalConstraint', 'verticalConstraint'];

function requireFigmaEditor() {
  if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '布局命令仅在 Figma Design 编辑器可用');
}

function requireProps(p, keys) {
  const props = p.props;
  if (!isPlainObject(props)) throw appErr('INVALID_PARAM', 'props 必须是普通对象');
  onlyKeys(props, keys);
  if (!Object.keys(props).length) throw appErr('INVALID_PARAM', 'props 至少包含一项');
  return props;
}

function orderLayoutProps(props) {
  const ordered = {};
  if (hasOwn(props, 'layoutMode')) ordered.layoutMode = props.layoutMode;
  for (const k of Object.keys(props)) if (k !== 'layoutMode') ordered[k] = props[k];
  return ordered;
}

async function handleSetLayout(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = orderLayoutProps(requireProps(p, SET_LAYOUT_KEYS));
  const node = await getNode(p.id, t);
  assertTarget(t);
  applyProps(node, props, t);
  return buildNodeInfo(node);
}

async function handleSetChildLayout(p, t) {
  onlyKeys(p, ['action', 'id', 'childIds', 'props']);
  const props = requireProps(p, CHILD_LAYOUT_KEYS);
  if (!Array.isArray(p.childIds) || p.childIds.length < 1 || p.childIds.length > 100) {
    throw appErr('INVALID_PARAM', 'childIds 必须是 1..100 个节点 id');
  }
  const container = await getNode(p.id, t);
  const children = [];
  for (const childId of p.childIds) {
    const child = await getNode(childId, t);
    if (!child.parent || child.parent.id !== container.id) {
      throw appErr('INVALID_TARGET', '子节点不在目标容器内');
    }
    children.push(child);
  }
  assertTarget(t);
  const results = [];
  for (const child of children) {
    applyProps(child, props, t);
    results.push({ id: child.id, applied: Object.keys(props) });
  }
  return { children: results };
}

async function handleRemoveLayout(p, t) {
  onlyKeys(p, ['action', 'id']);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (!('layoutMode' in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 layoutMode`);
  markMutation(t, node);
  node.layoutMode = 'NONE';
  return buildNodeInfo(node);
}

async function handleSetConstraints(p, t) {
  onlyKeys(p, ['action', 'id', 'props']);
  const props = requireProps(p, CONSTRAINT_KEYS);
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (!('constraints' in node)) throw appErr('UNSUPPORTED', `${node.type} 不支持 constraints`);
  // Realm-agnostic object check: cross-realm plain objects (e.g. from test
  // fixtures) do not share this realm's Object.prototype.
  const current = node.constraints && typeof node.constraints === 'object' && !Array.isArray(node.constraints)
    ? node.constraints : {};
  const next = {
    horizontal: hasOwn(props, 'horizontalConstraint') ? props.horizontalConstraint : (current.horizontal || 'MIN'),
    vertical: hasOwn(props, 'verticalConstraint') ? props.verticalConstraint : (current.vertical || 'MIN'),
  };
  markMutation(t, node);
  try {
    node.constraints = next;
  } catch (e) {
    const failure = appErr('PROP_APPLY_FAILED', e.message);
    failure.state = 'not_started';
    failure.details = { appliedProperties: [] };
    throw failure;
  }
  return { ...buildNodeInfo(node), constraints: cloneValue(node.constraints) };
}

export const handlers = {
  layout: async (p, t) => {
    requireFigmaEditor();
    if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    switch (p.action) {
      case 'setLayout': return handleSetLayout(p, t);
      case 'setChildLayout': return handleSetChildLayout(p, t);
      case 'removeLayout': return handleRemoveLayout(p, t);
      case 'setConstraints': return handleSetConstraints(p, t);
      default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
    }
  },
};
