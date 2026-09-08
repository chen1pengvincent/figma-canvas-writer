// Edit-domain tests (hierarchy / vector / layout / visual). Runs the real
// bundled plugin in the shared VM harness; node capability patches (clone,
// layout props, constraints, stroke detail, corner radii, absoluteTransform)
// are installed locally here since the shared helper leaves nodes bare.
import assert from 'node:assert/strict';
import { makePlugin, success, failure, plain, test } from './helpers/figma-vm.js';

// ---- local node capability patches ------------------------------------------

function installLayoutProps(node, overrides = {}) {
  const values = {
    layoutMode: 'NONE', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN',
    primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', itemSpacing: 0,
    counterAxisSpacing: null, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0,
    layoutWrap: 'NO_WRAP', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null,
    layoutAlign: 'INHERIT', layoutGrow: 0, layoutPositioning: 'AUTO',
    layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', ...overrides,
  };
  node.__appliedOrder = [];
  for (const [key, initial] of Object.entries(values)) {
    Object.defineProperty(node, key, {
      configurable: true, enumerable: true,
      get: () => values[key],
      set(value) {
        if (node.faults[key]) throw new Error(`Injected ${key} failure`);
        values[key] = value;
        node.__appliedOrder.push(key);
      },
    });
  }
  return node;
}

function installConstraints(node) {
  const sets = [];
  let current = { horizontal: 'MIN', vertical: 'MIN' };
  Object.defineProperty(node, 'constraints', {
    configurable: true, enumerable: true,
    get: () => ({ ...current }),
    set(value) {
      if (node.faults.constraints) throw new Error('Injected constraints failure');
      current = plain(value);
      sets.push(plain(value));
    },
  });
  node.__constraintSets = sets;
  return node;
}

function installStrokeProps(node, overrides = {}) {
  const values = {
    strokeAlign: 'CENTER', strokeCap: 'NONE', strokeJoin: 'MITER', strokeMiterLimit: 4,
    dashPattern: [], strokeTopWeight: 1, strokeBottomWeight: 1, strokeLeftWeight: 1, strokeRightWeight: 1,
    ...overrides,
  };
  node.__appliedOrder = [];
  for (const [key, initial] of Object.entries(values)) {
    Object.defineProperty(node, key, {
      configurable: true, enumerable: true,
      get: () => values[key],
      set(value) {
        if (node.faults[key]) throw new Error(`Injected ${key} failure`);
        values[key] = value;
        node.__appliedOrder.push(key);
      },
    });
  }
  return node;
}

function installCornerProps(node, overrides = {}) {
  const values = {
    topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0,
    cornerSmoothing: 0, ...overrides,
  };
  for (const [key, initial] of Object.entries(values)) {
    Object.defineProperty(node, key, {
      configurable: true, enumerable: true,
      get: () => values[key],
      set(value) {
        if (node.faults[key]) throw new Error(`Injected ${key} failure`);
        values[key] = value;
      },
    });
  }
  return node;
}

function installMaskType(node) {
  let value = 'ALPHA';
  Object.defineProperty(node, 'maskType', {
    configurable: true, enumerable: true,
    get: () => value,
    set(next) { value = next; },
  });
  return node;
}

const shadow = (over = {}) => ({
  type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 4 },
  radius: 8, visible: true, blendMode: 'NORMAL', ...over,
});

// The shared helper's makeNode gives BOOLEAN_OPERATION no children mixin, so
// the stock figma.union/subtract/intersect/exclude cannot assemble a boolean
// node. Patch faithful replacements here (base-layer issue reported separately).
function installBooleanOps(plugin) {
  const op = (operation) => (nodes, parent) => {
    assert.ok(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'].includes(operation), 'boolean operation kind');
    assert.ok(Array.isArray(nodes) && nodes.length >= 2, 'boolean op needs >= 2 nodes');
    const bool = plugin.seed('BOOLEAN_OPERATION');
    bool.children = [];
    bool.appendChild = (child) => {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = bool;
      bool.children.push(child);
    };
    bool.booleanOperation = operation;
    for (const child of nodes) bool.appendChild(child);
    (parent || plugin.pageA).appendChild(bool);
    return bool;
  };
  plugin.figma.union = op('UNION');
  plugin.figma.subtract = op('SUBTRACT');
  plugin.figma.intersect = op('INTERSECT');
  plugin.figma.exclude = op('EXCLUDE');
}

// ---- hierarchy ---------------------------------------------------------------

test('hierarchy: clone 通过 node.clone() 复制并回读新节点', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE', { name: 'src', x: 5, y: 6 });
  rect.clone = () => plugin.seed('RECTANGLE', { name: rect.name, x: rect.x + 16, y: rect.y });
  const data = success(await plugin.send('hierarchy', { action: 'clone', id: rect.id }));
  assert.equal(data.type, 'RECTANGLE');
  assert.equal(data.name, 'src');
  assert.equal(data.x, 21);
  assert.equal(data.y, 6);
  assert.equal(data.parentId, plugin.pageA.id);
  assert.notEqual(data.id, rect.id);
  assert.ok(data.affectedNodeIds.includes(rect.id));
  assert.ok(data.affectedNodeIds.includes(data.id));
  assert.ok(plugin.pageA.children.includes(plugin.nodes.get(data.id)));
  const renamed = success(await plugin.send('hierarchy', { action: 'clone', id: rect.id, name: '副本' }));
  assert.equal(renamed.name, '副本');
});

test('hierarchy: clone 缺失方法时返回 UNSUPPORTED', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  const before = plugin.mutations.length;
  const error = failure(await plugin.send('hierarchy', { action: 'clone', id: rect.id }));
  assert.equal(error.code, 'UNSUPPORTED');
  assert.equal(plugin.mutations.length, before);
  assert.equal(plugin.pageA.children.length, 1);
});

test('hierarchy: group 同父成功、命名与成员影响记录', async () => {
  const plugin = await makePlugin();
  const a = plugin.seed('RECTANGLE', { name: 'a' });
  const b = plugin.seed('ELLIPSE', { name: 'b' });
  const c = plugin.seed('RECTANGLE', { name: 'c' });
  const data = success(await plugin.send('hierarchy', { action: 'group', nodeIds: [a.id, b.id, c.id], name: 'Card' }));
  assert.equal(data.type, 'GROUP');
  assert.equal(data.name, 'Card');
  assert.equal(data.parentId, plugin.pageA.id);
  assert.equal(data.childrenCount, 3);
  const group = plugin.nodes.get(data.id);
  assert.deepEqual(group.children.map(n => n.id), [a.id, b.id, c.id]);
  for (const node of [group, a, b, c]) assert.ok(data.affectedNodeIds.includes(node.id), node.id);
  const single = success(await plugin.send('hierarchy', { action: 'group', nodeIds: [a.id] }));
  assert.equal(single.childrenCount, 1);
});

test('hierarchy: group 拒绝跨父节点', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const inner = plugin.seed('RECTANGLE');
  frame.appendChild(inner);
  const outer = plugin.seed('RECTANGLE');
  const before = plugin.mutations.length;
  const error = failure(await plugin.send('hierarchy', { action: 'group', nodeIds: [inner.id, outer.id] }));
  assert.equal(error.code, 'INVALID_TARGET');
  assert.match(error.message, /同一父节点/);
  assert.equal(plugin.mutations.length, before);
  assert.equal(inner.parent, frame);
});

test('hierarchy: group/ungroup 全链路（含无 figma.ungroup 的手动回退）', async () => {
  const plugin = await makePlugin();
  const a = plugin.seed('RECTANGLE');
  const b = plugin.seed('ELLIPSE');
  const group = plugin.figma.group([a, b], plugin.pageA);
  const data = success(await plugin.send('hierarchy', { action: 'ungroup', id: group.id }));
  assert.deepEqual(data.children, [a.id, b.id]);
  assert.equal(group.removed, true);
  assert.equal(a.parent, plugin.pageA);
  assert.equal(b.parent, plugin.pageA);
  assert.ok(data.affectedNodeIds.includes(group.id));
  assert.ok(data.affectedNodeIds.includes(a.id));
  const again = plugin.figma.group([a, b], plugin.pageA);
  delete plugin.figma.ungroup;
  const manual = success(await plugin.send('hierarchy', { action: 'ungroup', id: again.id }));
  assert.deepEqual(manual.children, [a.id, b.id]);
  assert.equal(again.removed, true);
  assert.equal(a.parent, plugin.pageA);
});

test('hierarchy: ungroup 非 GROUP 目标拒绝', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('hierarchy', { action: 'ungroup', id: rect.id })).code, 'INVALID_TARGET');
  assert.equal(failure(await plugin.send('hierarchy', { action: 'ungroup', id: '1:404' })).code, 'NODE_NOT_FOUND');
});

test('hierarchy: reparent keepLocal 移动节点（含移回页面顶层）', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const rect = plugin.seed('RECTANGLE', { x: 3, y: 4 });
  frame.appendChild(rect);
  const data = success(await plugin.send('hierarchy', { action: 'reparent', id: rect.id, parentId: frame.id }));
  assert.equal(data.parentId, frame.id);
  assert.equal(rect.parent, frame);
  const toPage = success(await plugin.send('hierarchy', { action: 'reparent', id: rect.id, parentId: plugin.pageA.id }));
  assert.equal(toPage.parentId, plugin.pageA.id);
  assert.equal(rect.parent, plugin.pageA);
});

test('hierarchy: reparent keepAbsolute 用 absoluteTransform 修正 x/y', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME', { x: 100, y: 50 });
  const rect = plugin.seed('RECTANGLE', { x: 10, y: 20 });
  rect.absoluteTransform = [[1, 0, 130], [0, 1, 90]];
  frame.absoluteTransform = [[1, 0, 100], [0, 1, 50]];
  const data = success(await plugin.send('hierarchy', {
    action: 'reparent', id: rect.id, parentId: frame.id, position: 'keepAbsolute',
  }));
  assert.equal(rect.parent, frame);
  assert.equal(rect.x, 30);
  assert.equal(rect.y, 40);
  assert.equal(data.x, 30);
});

test('hierarchy: reparent keepAbsolute 缺失 absoluteTransform 时 UNSUPPORTED', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const rect = plugin.seed('RECTANGLE');
  const error = failure(await plugin.send('hierarchy', {
    action: 'reparent', id: rect.id, parentId: frame.id, position: 'keepAbsolute',
  }));
  assert.equal(error.code, 'UNSUPPORTED');
  assert.equal(rect.parent, plugin.pageA);
});

test('hierarchy: reparent 拒绝循环层级', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const inner = plugin.seed('RECTANGLE');
  frame.appendChild(inner);
  const before = plugin.mutations.length;
  const intoChild = failure(await plugin.send('hierarchy', { action: 'reparent', id: frame.id, parentId: inner.id }));
  assert.equal(intoChild.code, 'INVALID_TARGET');
  assert.match(intoChild.message, /循环层级/);
  const intoSelf = failure(await plugin.send('hierarchy', { action: 'reparent', id: frame.id, parentId: frame.id }));
  assert.equal(intoSelf.code, 'INVALID_TARGET');
  assert.equal(plugin.mutations.length, before);
  assert.equal(inner.parent, frame);
});

test('hierarchy: reparent 拒绝其他页面的目标与非法 position', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('hierarchy', {
    action: 'reparent', id: rect.id, parentId: plugin.pageB.id,
  })).code, 'PAGE_CHANGED');
  assert.equal(failure(await plugin.send('hierarchy', {
    action: 'reparent', id: rect.id, parentId: rect.id, position: 'keepWorld',
  })).code, 'INVALID_PARAM');
});

test('hierarchy: reorder 用 beforeNodeId 与 index 重排', async () => {
  const plugin = await makePlugin();
  const a = plugin.seed('RECTANGLE', { name: 'a' });
  const b = plugin.seed('RECTANGLE', { name: 'b' });
  const c = plugin.seed('RECTANGLE', { name: 'c' });
  assert.deepEqual(plugin.pageA.children.map(n => n.id), [a.id, b.id, c.id]);
  const before = success(await plugin.send('hierarchy', { action: 'reorder', id: a.id, beforeNodeId: c.id }));
  assert.deepEqual(plugin.pageA.children.map(n => n.id), [b.id, c.id, a.id]);
  assert.equal(before.id, a.id);
  assert.equal(before.index, 2);
  const byIndex = success(await plugin.send('hierarchy', { action: 'reorder', id: c.id, index: 0 }));
  assert.deepEqual(plugin.pageA.children.map(n => n.id), [c.id, b.id, a.id]);
  assert.equal(byIndex.id, c.id);
  assert.equal(byIndex.index, 0);
  const append = success(await plugin.send('hierarchy', { action: 'reorder', id: c.id, index: 3 }));
  assert.equal(append.id, c.id);
  assert.equal(append.index, 2);
});

test('hierarchy: reorder 拒绝缺参/双参/越界/非兄弟参照', async () => {
  const plugin = await makePlugin();
  const a = plugin.seed('RECTANGLE');
  const b = plugin.seed('RECTANGLE');
  const frame = plugin.seed('FRAME');
  const stranger = plugin.seed('RECTANGLE');
  frame.appendChild(stranger);
  const before = plugin.mutations.length;
  assert.equal(failure(await plugin.send('hierarchy', { action: 'reorder', id: a.id })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('hierarchy', { action: 'reorder', id: a.id, index: 0, beforeNodeId: b.id })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('hierarchy', { action: 'reorder', id: a.id, index: 4 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('hierarchy', { action: 'reorder', id: a.id, beforeNodeId: stranger.id })).code, 'INVALID_PARAM');
  assert.equal(plugin.mutations.length, before);
  assert.deepEqual(plugin.pageA.children.map(n => n.id), [a.id, b.id, frame.id]);
});

// ---- vector ------------------------------------------------------------------

test('vector: createPolygon 先 pointCount 后 resize，参数透传', async () => {
  const plugin = await makePlugin();
  const data = success(await plugin.send('vector', {
    action: 'createPolygon', pointCount: 6, polygonWidth: 80, polygonHeight: 60,
    x: 5, y: 7, cornerRadius: 3, name: 'Hex',
  }));
  assert.equal(data.type, 'POLYGON');
  assert.equal(data.pointCount, 6);
  assert.equal(data.width, 80);
  assert.equal(data.height, 60);
  assert.equal(data.x, 5);
  assert.equal(data.y, 7);
  assert.equal(data.cornerRadius, 3);
  assert.equal(data.name, 'Hex');
  const node = plugin.nodes.get(data.id);
  assert.deepEqual(node.resizeCalls.at(-1), [80, 60]);
  const recs = plugin.mutations.filter(m => m.nodeId === data.id).map(m => m.prop);
  assert.ok(recs.includes('create'), recs.join(','));
  assert.ok(recs.indexOf('create') < recs.indexOf('pointCount'), recs.join(','));
  assert.ok(recs.indexOf('pointCount') < recs.indexOf('size'), recs.join(','));
  assert.ok(recs.indexOf('size') < recs.indexOf('x'), recs.join(','));
  const frame = plugin.seed('FRAME');
  const placed = success(await plugin.send('vector', { action: 'createPolygon', parentId: frame.id, polygonWidth: 40 }));
  assert.equal(placed.parentId, frame.id);
  assert.equal(plugin.nodes.get(placed.id).parent, frame);
  assert.equal(failure(await plugin.send('vector', { action: 'createPolygon', pointCount: 2 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'createPolygon', polygonWidth: 0 })).code, 'INVALID_PARAM');
});

test('vector: createPolygon 属性失败时回滚新建节点', async () => {
  const plugin = await makePlugin();
  const rawCreate = plugin.figma.createPolygon;
  plugin.figma.createPolygon = () => {
    const node = rawCreate();
    node.faults.pointCount = true;
    return node;
  };
  const error = failure(await plugin.send('vector', { action: 'createPolygon', pointCount: 6 }));
  assert.equal(error.state, 'rolled_back');
  assert.deepEqual(error.affectedNodeIds, []);
  assert.equal(plugin.pageA.children.filter(n => n.type === 'POLYGON').length, 0);
});

test('vector: createVectorPaths 校验并写入 vectorPaths', async () => {
  const plugin = await makePlugin();
  const paths = [
    { windingRule: 'NONZERO', data: 'M 0 0 L 10 0 L 10 10 Z' },
    { windingRule: 'EVENODD', data: 'm 2 2 L 8 2 Z' },
  ];
  const data = success(await plugin.send('vector', { action: 'createVectorPaths', paths, x: 1, y: 2, name: 'Arrow' }));
  assert.equal(data.type, 'VECTOR');
  assert.equal(data.name, 'Arrow');
  assert.deepEqual(data.vectorPaths, paths);
  assert.deepEqual(plain(plugin.nodes.get(data.id).vectorPaths), paths);
  assert.deepEqual(plain(data.vectorPaths), paths);
  const bad = [
    { paths: [] },
    { paths: [{ windingRule: 'NONZERO' }] },
    { paths: [{ windingRule: 'BOGUS', data: 'M 0 0' }] },
    { paths: [{ windingRule: 'NONZERO', data: 'L 0 0' }] },
    { paths: [{ windingRule: 'NONZERO', data: '' }] },
    { paths: [{ windingRule: 'NONZERO', data: 5 }] },
    { paths: Array.from({ length: 65 }, () => ({ windingRule: 'NONE', data: 'M 0 0' })) },
  ];
  for (const extra of bad) {
    assert.equal(failure(await plugin.send('vector', { action: 'createVectorPaths', ...extra })).code, 'INVALID_PARAM', JSON.stringify(extra));
  }
});

test('vector: boolean 生成布尔节点并保持操作数顺序', async () => {
  const plugin = await makePlugin();
  installBooleanOps(plugin);
  const a = plugin.seed('RECTANGLE');
  const b = plugin.seed('ELLIPSE');
  const data = success(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, b.id], operation: 'SUBTRACT' }));
  assert.equal(data.type, 'BOOLEAN_OPERATION');
  assert.equal(data.parentId, plugin.pageA.id);
  const bool = plugin.nodes.get(data.id);
  assert.equal(bool.booleanOperation, 'SUBTRACT');
  assert.deepEqual(bool.children.map(n => n.id), [a.id, b.id]);
  for (const node of [bool, a, b]) assert.ok(data.affectedNodeIds.includes(node.id), node.id);
  const frame = plugin.seed('FRAME');
  const placed = success(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, b.id], operation: 'UNION', parentId: frame.id }));
  assert.equal(placed.parentId, frame.id);
  assert.equal(failure(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, b.id], operation: 'XOR' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, b.id] })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id], operation: 'UNION' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, '1:404'], operation: 'UNION' })).code, 'NODE_NOT_FOUND');
  const keep = plugin.figma.union;
  delete plugin.figma.union;
  assert.equal(failure(await plugin.send('vector', { action: 'boolean', nodeIds: [a.id, b.id], operation: 'UNION' })).code, 'UNSUPPORTED');
  plugin.figma.union = keep;
});

test('vector: setShapeParams 按节点类型校验并写回', async () => {
  const plugin = await makePlugin();
  const polygon = plugin.seed('POLYGON');
  const star = plugin.seed('STAR');
  const rect = plugin.seed('RECTANGLE');
  const poly = success(await plugin.send('vector', { action: 'setShapeParams', id: polygon.id, pointCount: 8, cornerRadius: 2 }));
  assert.equal(poly.pointCount, 8);
  assert.equal(poly.cornerRadius, 2);
  const starData = success(await plugin.send('vector', { action: 'setShapeParams', id: star.id, pointCount: 9, innerRadius: 0.5 }));
  assert.equal(starData.pointCount, 9);
  assert.equal(starData.innerRadius, 0.5);
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: rect.id, pointCount: 5 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: polygon.id, innerRadius: 0.5 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: star.id, pointCount: 2 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: star.id, innerRadius: 1.5 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: rect.id })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('vector', { action: 'setShapeParams', id: '1:404', pointCount: 5 })).code, 'NODE_NOT_FOUND');
});

test('vector: setVectorNetwork 校验顶点/线段索引并回读', async () => {
  const plugin = await makePlugin();
  const vector = plugin.seed('VECTOR');
  const network = {
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 }],
    regions: [],
  };
  const data = success(await plugin.send('vector', { action: 'setVectorNetwork', id: vector.id, vectorNetwork: network }));
  assert.deepEqual(data.vectorNetwork, network);
  assert.deepEqual(plain(vector.vectorNetwork), network);
  const rect = plugin.seed('RECTANGLE');
  const bad = [
    { vertices: [{ x: 0, y: 0 }], segments: [] },
    { vertices: 'nope', segments: [] },
    { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: [{ start: 0, end: 5 }] },
    { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: [{ start: 0.5, end: 1 }] },
    { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: [{ start: 0 }] },
    { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: {}, },
    { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: [], regions: {} },
  ];
  for (const broken of bad) {
    assert.equal(failure(await plugin.send('vector', { action: 'setVectorNetwork', id: vector.id, vectorNetwork: broken })).code, 'INVALID_PARAM', JSON.stringify(broken));
  }
  assert.equal(failure(await plugin.send('vector', { action: 'setVectorNetwork', id: rect.id, vectorNetwork: network })).code, 'INVALID_TARGET');
});

// ---- layout ------------------------------------------------------------------

test('layout: setLayout 先 layoutMode 再其余键，部分更新生效', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  installLayoutProps(frame);
  const data = success(await plugin.send('layout', {
    action: 'setLayout', id: frame.id,
    props: { itemSpacing: 12, layoutMode: 'HORIZONTAL', paddingTop: 8 },
  }));
  assert.equal(data.id, frame.id);
  assert.equal(frame.layoutMode, 'HORIZONTAL');
  assert.equal(frame.itemSpacing, 12);
  assert.equal(frame.paddingTop, 8);
  const order = frame.__appliedOrder;
  assert.ok(order.indexOf('layoutMode') < order.indexOf('itemSpacing'), order.join(','));
  assert.ok(order.indexOf('itemSpacing') < order.indexOf('paddingTop'), order.join(','));
});

test('layout: setLayout 部分失败报 appliedProperties 与 partial', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  installLayoutProps(frame);
  frame.faults.itemSpacing = true;
  const error = failure(await plugin.send('layout', {
    action: 'setLayout', id: frame.id,
    props: { layoutMode: 'VERTICAL', itemSpacing: 10, paddingTop: 4 },
  }));
  assert.equal(error.code, 'PROP_APPLY_FAILED');
  assert.equal(error.state, 'partial');
  assert.deepEqual(error.details.appliedProperties, ['layoutMode']);
  assert.equal(frame.layoutMode, 'VERTICAL');
  assert.equal(frame.itemSpacing, 0);
  assert.equal(frame.paddingTop, 0);
  assert.ok(error.affectedNodeIds.includes(frame.id));
});

test('layout: setLayout 拒绝未知键与不支持的属性', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  installLayoutProps(frame);
  const bare = plugin.seed('FRAME');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: frame.id, props: { layoutAlign: 'STRETCH' } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: bare.id, props: { layoutMode: 'HORIZONTAL' } })).code, 'UNSUPPORTED_PROPERTY');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: frame.id, props: {} })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: frame.id })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: '1:404', props: { layoutMode: 'HORIZONTAL' } })).code, 'NODE_NOT_FOUND');
});

test('layout: setChildLayout 逐子节点应用并回读 applied', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const c1 = plugin.seed('RECTANGLE');
  const c2 = plugin.seed('RECTANGLE');
  frame.appendChild(c1);
  frame.appendChild(c2);
  installLayoutProps(c1);
  installLayoutProps(c2);
  const data = success(await plugin.send('layout', {
    action: 'setChildLayout', id: frame.id, childIds: [c1.id, c2.id],
    props: { layoutAlign: 'STRETCH', layoutGrow: 1 },
  }));
  assert.deepEqual(data.children, [
    { id: c1.id, applied: ['layoutAlign', 'layoutGrow'] },
    { id: c2.id, applied: ['layoutAlign', 'layoutGrow'] },
  ]);
  assert.equal(c1.layoutAlign, 'STRETCH');
  assert.equal(c2.layoutGrow, 1);
  assert.ok(data.affectedNodeIds.includes(c1.id));
  assert.ok(data.affectedNodeIds.includes(c2.id));
  const outsider = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('layout', { action: 'setChildLayout', id: frame.id, childIds: [outsider.id], props: { layoutGrow: 1 } })).code, 'INVALID_TARGET');
  assert.equal(failure(await plugin.send('layout', { action: 'setChildLayout', id: frame.id, childIds: [], props: { layoutGrow: 1 } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('layout', { action: 'setChildLayout', id: frame.id, childIds: [c1.id], props: { itemSpacing: 4 } })).code, 'INVALID_PARAM');
  const bare = plugin.seed('RECTANGLE');
  frame.appendChild(bare);
  assert.equal(failure(await plugin.send('layout', { action: 'setChildLayout', id: frame.id, childIds: [bare.id], props: { layoutGrow: 1 } })).code, 'UNSUPPORTED_PROPERTY');
});

test('layout: removeLayout 置 NONE，不支持的节点报 UNSUPPORTED_PROPERTY', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  installLayoutProps(frame, { layoutMode: 'VERTICAL' });
  const data = success(await plugin.send('layout', { action: 'removeLayout', id: frame.id }));
  assert.equal(data.id, frame.id);
  assert.equal(frame.layoutMode, 'NONE');
  const bare = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('layout', { action: 'removeLayout', id: bare.id })).code, 'UNSUPPORTED_PROPERTY');
  assert.equal(failure(await plugin.send('layout', { action: 'removeLayout', id: '1:404' })).code, 'NODE_NOT_FOUND');
});

test('layout: setConstraints 合并既有约束并记录 setter 调用', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  installConstraints(rect);
  const data = success(await plugin.send('layout', { action: 'setConstraints', id: rect.id, props: { horizontalConstraint: 'STRETCH' } }));
  assert.deepEqual(data.constraints, { horizontal: 'STRETCH', vertical: 'MIN' });
  assert.deepEqual(rect.__constraintSets, [{ horizontal: 'STRETCH', vertical: 'MIN' }]);
  const second = success(await plugin.send('layout', { action: 'setConstraints', id: rect.id, props: { verticalConstraint: 'CENTER' } }));
  assert.deepEqual(second.constraints, { horizontal: 'STRETCH', vertical: 'CENTER' });
  assert.deepEqual(rect.__constraintSets[1], { horizontal: 'STRETCH', vertical: 'CENTER' });
  const bare = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('layout', { action: 'setConstraints', id: bare.id, props: { horizontalConstraint: 'MAX' } })).code, 'UNSUPPORTED');
  assert.equal(failure(await plugin.send('layout', { action: 'setConstraints', id: rect.id, props: {} })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('layout', { action: 'setConstraints', id: rect.id, props: { itemSpacing: 4 } })).code, 'INVALID_PARAM');
  rect.faults.constraints = true;
  const error = failure(await plugin.send('layout', { action: 'setConstraints', id: rect.id, props: { horizontalConstraint: 'MAX' } }));
  assert.equal(error.code, 'PROP_APPLY_FAILED');
  assert.equal(error.state, 'not_started');
});

// ---- visual ------------------------------------------------------------------

test('visual: setEffects 校验 effect 结构并回读', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  const drop = shadow();
  const blur = { type: 'LAYER_BLUR', radius: 4, visible: true };
  const data = success(await plugin.send('visual', { action: 'setEffects', id: rect.id, props: { effects: [drop, blur] } }));
  assert.deepEqual(data.effects, [drop, blur]);
  assert.deepEqual(plain(rect.effects), [drop, blur]);
  assert.ok(data.affectedNodeIds.includes(rect.id));
  assert.ok(plugin.mutations.some(m => m.nodeId === rect.id && m.prop === 'effects'));
  const invalid = [
    { effects: [{ type: 'GLOW' }] },
    { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: 4, visible: true }] },
    { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, offset: { x: 0, y: 0 }, radius: 4, visible: true, blendMode: 'NORMAL' }] },
    { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0 }, radius: 4, visible: true, blendMode: 'NORMAL' }] },
    { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: -1, visible: true, blendMode: 'NORMAL' }] },
    { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: 4, visible: 'yes', blendMode: 'NORMAL' }] },
    { effects: [{ type: 'LAYER_BLUR', radius: 4 }] },
    { effects: [{ type: 'BACKGROUND_BLUR', visible: true }] },
    { effects: [{ type: 'LAYER_BLUR', radius: 4, visible: true }, 'nope'] },
    { effects: 'nope' },
    { effects: Array.from({ length: 33 }, () => ({ type: 'LAYER_BLUR', radius: 1, visible: true })) },
    {},
  ];
  const before = plugin.mutations.length;
  for (const props of invalid) {
    assert.equal(failure(await plugin.send('visual', { action: 'setEffects', id: rect.id, props })).code, 'INVALID_PARAM', JSON.stringify(props));
  }
  assert.equal(plugin.mutations.length, before);
  rect.faults.effects = true;
  const applyError = failure(await plugin.send('visual', { action: 'setEffects', id: rect.id, props: { effects: [blur] } }));
  assert.equal(applyError.code, 'PROP_APPLY_FAILED');
  assert.equal(applyError.state, 'not_started');
  rect.faults.effects = false;
});

test('visual: setBlend 白名单校验并写回', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  const data = success(await plugin.send('visual', { action: 'setBlend', id: rect.id, props: { blendMode: 'MULTIPLY' } }));
  assert.equal(data.blendMode, 'MULTIPLY');
  assert.equal(rect.blendMode, 'MULTIPLY');
  assert.equal(failure(await plugin.send('visual', { action: 'setBlend', id: rect.id, props: { blendMode: 'MAGIC' } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setBlend', id: rect.id, props: {} })).code, 'INVALID_PARAM');
});

test('visual: setClip 校验 clipsContent 支持', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const data = success(await plugin.send('visual', { action: 'setClip', id: frame.id, props: { clipsContent: false } }));
  assert.equal(data.clipsContent, false);
  assert.equal(frame.clipsContent, false);
  assert.equal(failure(await plugin.send('visual', { action: 'setClip', id: frame.id, props: { isMask: true } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setClip', id: frame.id, props: {} })).code, 'INVALID_PARAM');
});

test('visual: setMask 写 isMask，maskType 仅在节点支持时赋值', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  const data = success(await plugin.send('visual', { action: 'setMask', id: rect.id, props: { isMask: true, maskType: 'LUMINANCE' } }));
  assert.equal(data.isMask, true);
  assert.equal(rect.isMask, true);
  assert.equal(data.maskType, undefined, 'maskType must be skipped on nodes without it');
  const masked = installMaskType(plugin.seed('RECTANGLE'));
  const withType = success(await plugin.send('visual', { action: 'setMask', id: masked.id, props: { isMask: true, maskType: 'LUMINANCE' } }));
  assert.equal(withType.maskType, 'LUMINANCE');
  assert.equal(failure(await plugin.send('visual', { action: 'setMask', id: rect.id, props: { isMask: 'yes' } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setMask', id: rect.id, props: { maskType: 'ALPHA' } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setMask', id: rect.id, props: {} })).code, 'INVALID_PARAM');
});

test('visual: setGrids 校验网格结构并回读', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const grids = [
    { type: 'GRID_COLUMNS', count: 12, gutterSize: 20, alignment: 'CENTER' },
    { type: 'GRID_ROWS', sectionSize: 8 },
    { type: 'GRID_UNIFORM', sectionSize: 16 },
  ];
  const data = success(await plugin.send('visual', { action: 'setGrids', id: frame.id, props: { layoutGrids: grids } }));
  assert.deepEqual(data.layoutGrids, grids);
  assert.deepEqual(plain(frame.layoutGrids), grids);
  const cleared = success(await plugin.send('visual', { action: 'setGrids', id: frame.id, props: { layoutGrids: [] } }));
  assert.deepEqual(cleared.layoutGrids, []);
  assert.deepEqual(plain(frame.layoutGrids), []);
  const restored = success(await plugin.send('visual', { action: 'setGrids', id: frame.id, props: { layoutGrids: grids } }));
  assert.deepEqual(restored.layoutGrids, grids);
  const invalid = [
    { layoutGrids: [{ type: 'COLUMNS', count: 12 }] },
    { layoutGrids: [{ type: 'GRID_MAGIC' }] },
    { layoutGrids: [{ type: 'GRID_COLUMNS' }] },
    { layoutGrids: [{ type: 'GRID_COLUMNS', count: 0 }] },
    { layoutGrids: [{ type: 'GRID_COLUMNS', count: 101 }] },
    { layoutGrids: [{ type: 'GRID_UNIFORM' }] },
    { layoutGrids: [{ type: 'GRID_UNIFORM', sectionSize: 16, count: 2 }] },
    { layoutGrids: [{ type: 'GRID_COLUMNS', count: 12, alignment: 'SKEW' }] },
    { layoutGrids: [{ type: 'GRID_COLUMNS', count: 12, bogus: 1 }] },
    { layoutGrids: Array.from({ length: 17 }, () => ({ type: 'GRID_UNIFORM', sectionSize: 1 })) },
    {},
  ];
  const before = plugin.mutations.length;
  for (const props of invalid) {
    assert.equal(failure(await plugin.send('visual', { action: 'setGrids', id: frame.id, props })).code, 'INVALID_PARAM', JSON.stringify(props));
  }
  assert.equal(plugin.mutations.length, before);
});

test('visual: setStrokeDetail 全量写回与分边限制', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  installStrokeProps(rect);
  const props = {
    strokeAlign: 'INSIDE', strokeCap: 'ROUND', strokeJoin: 'BEVEL',
    strokeMiterLimit: 8, dashPattern: [4, 8], strokeTopWeight: 2, strokeBottomWeight: 0,
  };
  const data = success(await plugin.send('visual', { action: 'setStrokeDetail', id: rect.id, props }));
  assert.equal(data.strokeAlign, 'INSIDE');
  assert.equal(data.strokeCap, 'ROUND');
  assert.equal(data.strokeJoin, 'BEVEL');
  assert.equal(data.strokeMiterLimit, 8);
  assert.deepEqual(data.dashPattern, [4, 8]);
  assert.equal(data.strokeTopWeight, 2);
  assert.equal(data.strokeBottomWeight, 0);
  assert.ok(rect.__appliedOrder.includes('strokeAlign'));
  assert.ok(rect.__appliedOrder.includes('strokeTopWeight'));
  const bare = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('visual', { action: 'setStrokeDetail', id: bare.id, props: { strokeTopWeight: 2 } })).code, 'INVALID_PARAM');
  assert.match(failure(await plugin.send('visual', { action: 'setStrokeDetail', id: bare.id, props: { strokeTopWeight: 2 } })).message, /分边描边/);
  assert.equal(failure(await plugin.send('visual', { action: 'setStrokeDetail', id: bare.id, props: { strokeAlign: 'INSIDE' } })).code, 'UNSUPPORTED_PROPERTY');
  const invalid = [
    { strokeAlign: 'MIDDLE' },
    { strokeCap: 'ARROW' },
    { strokeJoin: 'SPLINE' },
    { strokeMiterLimit: 1001 },
    { dashPattern: [-1] },
    { dashPattern: Array.from({ length: 33 }, () => 1) },
    { strokeTopWeight: -2 },
    {},
  ];
  const before = plugin.mutations.length;
  for (const props of invalid) {
    assert.equal(failure(await plugin.send('visual', { action: 'setStrokeDetail', id: rect.id, props })).code, 'INVALID_PARAM', JSON.stringify(props));
  }
  assert.equal(plugin.mutations.length, before);
  rect.faults.strokeJoin = true;
  const error = failure(await plugin.send('visual', { action: 'setStrokeDetail', id: rect.id, props: { strokeAlign: 'OUTSIDE', strokeJoin: 'ROUND' } }));
  assert.equal(error.code, 'PROP_APPLY_FAILED');
  assert.equal(error.state, 'partial');
  assert.deepEqual(error.details.appliedProperties, ['strokeAlign']);
  assert.equal(rect.strokeAlign, 'OUTSIDE');
  assert.equal(rect.strokeJoin, 'BEVEL');
});

test('visual: setCornerRadii 分角圆角仅节点支持时生效', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  installCornerProps(rect);
  const data = success(await plugin.send('visual', {
    action: 'setCornerRadii', id: rect.id,
    props: { topLeftRadius: 8, topRightRadius: 8, bottomLeftRadius: 4, bottomRightRadius: 4, cornerSmoothing: 0.6 },
  }));
  assert.equal(data.topLeftRadius, 8);
  assert.equal(data.bottomRightRadius, 4);
  assert.equal(data.cornerSmoothing, 0.6);
  const bare = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('visual', { action: 'setCornerRadii', id: bare.id, props: { topLeftRadius: 8 } })).code, 'INVALID_PARAM');
  assert.match(failure(await plugin.send('visual', { action: 'setCornerRadii', id: bare.id, props: { topLeftRadius: 8 } })).message, /分角圆角/);
  assert.equal(failure(await plugin.send('visual', { action: 'setCornerRadii', id: bare.id, props: { cornerSmoothing: 0.5 } })).code, 'UNSUPPORTED_PROPERTY');
  assert.equal(failure(await plugin.send('visual', { action: 'setCornerRadii', id: rect.id, props: {} })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setCornerRadii', id: rect.id, props: { cornerSmoothing: 1.5 } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('visual', { action: 'setCornerRadii', id: rect.id, props: { topLeftRadius: -1 } })).code, 'INVALID_PARAM');
});

// ---- cross-cutting -----------------------------------------------------------

test('edit-domain: 能力发现上报四个域', async () => {
  const plugin = await makePlugin();
  const data = success(await plugin.send('getCapabilities'));
  const expected = {
    hierarchy: ['clone', 'group', 'ungroup', 'reparent', 'reorder'],
    vector: ['createPolygon', 'createVectorPaths', 'boolean', 'setShapeParams', 'setVectorNetwork'],
    layout: ['setLayout', 'setChildLayout', 'removeLayout', 'setConstraints'],
    visual: ['setEffects', 'setBlend', 'setClip', 'setMask', 'setGrids', 'setStrokeDetail', 'setCornerRadii'],
  };
  for (const [name, actions] of Object.entries(expected)) {
    const domain = data.domains.find(d => d.name === name);
    assert.ok(domain, name);
    assert.equal(domain.status, 'implemented', name);
    for (const action of actions) assert.ok(domain.actions.includes(action), `${name}:${action}`);
  }
});

test('edit-domain: 非 figma 编辑器拒绝四个域', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  assert.equal(failure(await plugin.send('hierarchy', { action: 'clone', id: '1:1' })).code, 'EDITOR_UNSUPPORTED');
  assert.equal(failure(await plugin.send('vector', { action: 'createPolygon' })).code, 'EDITOR_UNSUPPORTED');
  assert.equal(failure(await plugin.send('layout', { action: 'setLayout', id: '1:1', props: { layoutMode: 'HORIZONTAL' } })).code, 'EDITOR_UNSUPPORTED');
  assert.equal(failure(await plugin.send('visual', { action: 'setBlend', id: '1:1', props: { blendMode: 'NORMAL' } })).code, 'EDITOR_UNSUPPORTED');
});
