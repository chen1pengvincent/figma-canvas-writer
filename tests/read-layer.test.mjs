// Semantic read domain tests: queryNodes / getChildren / readField /
// getTextRuns / getDesignContext, run against the bundled plugin in the
// shared VM fixture. Node/figma patches are applied locally per test.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makePlugin, success, failure, test, inter } from './helpers/figma-vm.js';

const simpleDigest = (text) => {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return [text.length, hash.toString(36), text.slice(0, 64), text.slice(-64)].join('|');
};

// ---- queryNodes ---------------------------------------------------------------

test('queryNodes filters by type across top-level and nested nodes with projection', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME', { name: 'Board' });
  const nested = plugin.seed('RECTANGLE', { name: 'nested-card', x: 5 });
  frame.appendChild(nested);
  const top = plugin.seed('RECTANGLE', { name: 'top-card', x: 9 });
  const before = plugin.mutations.length;
  const data = success(await plugin.send('queryNodes', { type: 'RECTANGLE', projection: ['x', 'width'] }));
  assert.equal(data.total, 2);
  assert.deepEqual(data.nodes.map(n => n.id), [top.id, nested.id]);
  assert.equal(data.nodes[0].x, 9);
  assert.equal(data.nodes[0].width, 100);
  assert.equal(data.nodes[0].fills, undefined);
  assert.equal(data.nextCursor, null);
  assert.equal(data.truncated, false);
  assert.equal(data.sessionId, plugin.context.sessionId);
  assert.equal(data.pageId, plugin.context.pageId);
  assert.equal(plugin.mutations.length, before, 'queryNodes must stay read-only');
});

test('queryNodes matches nameContains and exactName and stays on the current page', async () => {
  const plugin = await makePlugin();
  plugin.seed('RECTANGLE', { name: 'alpha-button' });
  plugin.seed('TEXT', { name: 'alpha-text', text: 'hi' });
  plugin.seed('RECTANGLE', { name: 'alpha-elsewhere' }, plugin.pageB);
  const contains = success(await plugin.send('queryNodes', { nameContains: 'alpha' }));
  assert.deepEqual(contains.nodes.map(n => n.name), ['alpha-button', 'alpha-text']);
  assert.equal(contains.total, 2);
  const exact = success(await plugin.send('queryNodes', { exactName: 'alpha-button' }));
  assert.deepEqual(exact.nodes.map(n => n.name), ['alpha-button']);
  const both = success(await plugin.send('queryNodes', { nameContains: 'alpha', exactName: 'beta' }));
  assert.deepEqual(both.nodes, []);
});

test('queryNodes returns empty result sets verbatim', async () => {
  const plugin = await makePlugin();
  plugin.seed('RECTANGLE', { name: 'only' });
  const data = success(await plugin.send('queryNodes', { type: 'VECTOR' }));
  assert.deepEqual(data.nodes, []);
  assert.equal(data.total, 0);
  assert.equal(data.nextCursor, null);
  assert.equal(data.truncated, false);
});

test('queryNodes paginates and continuation pins membership via handle cursors', async () => {
  const plugin = await makePlugin();
  const expected = Array.from({ length: 5 }, (_, i) => plugin.seed('RECTANGLE', { name: `p${i}` }).id);
  const found = [];
  let cursor;
  const totals = [];
  for (let page = 0; page < 3; page += 1) {
    const data = success(await plugin.send('queryNodes', { type: 'RECTANGLE', limit: 2, ...(cursor === undefined ? {} : { cursor }) }));
    found.push(...data.nodes.map(n => n.id));
    totals.push(data.total);
    assert.equal(data.truncated, page < 2);
    cursor = data.nextCursor;
    if (page < 2) assert.match(cursor, /^h_[0-9a-z]+$/, 'continuation must use a fixed-membership handle cursor');
  }
  // total on a continuation page is the pinned remaining-sequence size.
  assert.deepEqual(totals, [5, 3, 3]);
  assert.equal(cursor, null);
  assert.deepEqual(found, expected);
  // Members added after the cursor was issued never join the pinned sequence.
  plugin.seed('RECTANGLE', { name: 'late' });
  const drifted = success(await plugin.send('queryNodes', { type: 'RECTANGLE', limit: 10 }));
  assert.equal(drifted.total, 6);
  assert.equal(failure(await plugin.send('queryNodes', { type: 'RECTANGLE', cursor: '10' })).code, 'INVALID_PARAM');
});

test('queryNodes rejects malformed cursors and limits', async () => {
  const plugin = await makePlugin();
  assert.equal(failure(await plugin.send('queryNodes', { cursor: 'abc' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('queryNodes', { limit: 0 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('queryNodes', { limit: 101 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('queryNodes', { type: 5 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('queryNodes', { projection: 'x' })).code, 'INVALID_PARAM');
});

test('queryNodes scans the tree manually when the page lacks findAll', async () => {
  const plugin = await makePlugin();
  delete plugin.pageA.findAll;
  const frame = plugin.seed('FRAME', { name: 'root' });
  const nested = plugin.seed('RECTANGLE', { name: 'deep' });
  frame.appendChild(nested);
  plugin.seed('ELLIPSE', { name: 'sibling' });
  const data = success(await plugin.send('queryNodes', { type: 'RECTANGLE' }));
  assert.deepEqual(data.nodes.map(n => n.id), [nested.id]);
});

// ---- getChildren ----------------------------------------------------------------

test('getChildren snapshots fixed membership and pages through members', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME', { name: 'box' });
  const expected = Array.from({ length: 5 }, (_, i) => plugin.seed('RECTANGLE', { name: `c${i}` }, frame).id);
  const first = success(await plugin.send('getChildren', { id: frame.id, limit: 2 }));
  assert.equal(first.total, 5);
  assert.deepEqual(first.nodes.map(n => n.id), expected.slice(0, 2));
  assert.equal(first.nextOffset, 2);
  assert.equal(first.truncated, true);
  assert.equal(typeof first.cursorId, 'string');
  const second = success(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId, limit: 2 }));
  assert.deepEqual(second.nodes.map(n => n.id), expected.slice(2, 4));
  assert.equal(second.nextOffset, 4);
  assert.equal(second.expiredMembers, 0);
  const third = success(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId, limit: 2 }));
  assert.deepEqual(third.nodes.map(n => n.id), expected.slice(4, 5));
  assert.equal(third.nextOffset, null);
  assert.equal(third.truncated, false);
});

test('getChildren keeps membership fixed when the container grows', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const a = plugin.seed('RECTANGLE', { name: 'a' }, frame);
  const b = plugin.seed('RECTANGLE', { name: 'b' }, frame);
  const first = success(await plugin.send('getChildren', { id: frame.id, limit: 1 }));
  assert.deepEqual(first.nodes.map(n => n.id), [a.id]);
  const latecomer = plugin.seed('RECTANGLE', { name: 'late' }, frame);
  const second = success(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId, limit: 10 }));
  assert.equal(second.total, 2);
  assert.deepEqual(second.nodes.map(n => n.id), [b.id]);
  assert.ok(!second.nodes.some(n => n.id === latecomer.id));
  assert.equal(second.nextOffset, null);
});

test('getChildren marks removed and moved-out members as expired', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  plugin.seed('RECTANGLE', { name: 'a' }, frame);
  const b = plugin.seed('RECTANGLE', { name: 'b' }, frame);
  const c = plugin.seed('RECTANGLE', { name: 'c' }, frame);
  const first = success(await plugin.send('getChildren', { id: frame.id, limit: 1 }));
  b.remove();
  plugin.pageB.appendChild(c);
  const second = success(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId, limit: 10 }));
  assert.deepEqual(second.nodes.map(n => n.id), [b.id, c.id]);
  assert.deepEqual(second.nodes.map(n => n.expired), [true, true]);
  assert.equal(second.expiredMembers, 2);
  assert.equal(second.total, 3);
});

test('getChildren continuation rejects unknown and stale cursors', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  plugin.seed('RECTANGLE', {}, frame);
  const first = success(await plugin.send('getChildren', { id: frame.id }));
  assert.equal(failure(await plugin.send('getChildren', { id: frame.id, cursor: '999' })).code, 'CURSOR_NOT_FOUND');
  plugin.switchPage(plugin.pageB);
  assert.equal(failure(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId })).code, 'CURSOR_STALE');
});

test('getChildren continuation expires after the handle TTL', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  plugin.seed('RECTANGLE', {}, frame);
  const first = success(await plugin.send('getChildren', { id: frame.id }));
  vm.runInContext('globalThis.__fcwNow = Date.now; Date.now = () => globalThis.__fcwNow() + 121000;', plugin.sandbox);
  try {
    const error = failure(await plugin.send('getChildren', { id: frame.id, cursor: first.cursorId }));
    assert.equal(error.code, 'CURSOR_EXPIRED');
  } finally {
    vm.runInContext('Date.now = globalThis.__fcwNow;', plugin.sandbox);
  }
});

test('getChildren validates target nodes and parameters', async () => {
  const plugin = await makePlugin();
  assert.equal(failure(await plugin.send('getChildren', {})).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('getChildren', { id: 'nope:1' })).code, 'NODE_NOT_FOUND');
  assert.equal(failure(await plugin.send('getChildren', { id: plugin.pageA.id })).code, 'INVALID_TARGET');
  assert.equal(failure(await plugin.send('getChildren', { id: plugin.pageA.id, limit: 0 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('getChildren', { id: plugin.pageA.id, cursor: 'abc' })).code, 'INVALID_PARAM');
});

test('getChildren passes the field projection through to node info', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const child = plugin.seed('RECTANGLE', { x: 3, name: 'kid' }, frame);
  const data = success(await plugin.send('getChildren', { id: frame.id, projection: ['x'] }));
  assert.equal(data.nodes[0].id, child.id);
  assert.equal(data.nodes[0].x, 3);
  assert.equal(data.nodes[0].width, undefined);
  assert.equal(data.nodes[0].fills, undefined);
});

// ---- readField ------------------------------------------------------------------

test('readField returns current values with context', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE', { name: 'card', x: 7 });
  const data = success(await plugin.send('readField', { nodeIds: [rect.id], fields: ['x', 'name', 'width'] }));
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].id, rect.id);
  assert.deepEqual(data.results[0].fields.x, { status: 'value', value: 7 });
  assert.deepEqual(data.results[0].fields.name, { status: 'value', value: 'card' });
  assert.deepEqual(data.results[0].fields.width, { status: 'value', value: 100 });
  assert.equal(data.sessionId, plugin.context.sessionId);
  assert.equal(data.pageId, plugin.context.pageId);
});

test('readField distinguishes absent and mixed without inventing values', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  const other = { family: 'Roboto', style: 'Bold' };
  const text = plugin.seed('TEXT', { text: 'mixed', fonts: [inter, other] });
  const data = success(await plugin.send('readField', { nodeIds: [rect.id, text.id], fields: ['characters', 'fontName'] }));
  assert.deepEqual(data.results[0].fields.characters, { status: 'absent' });
  assert.deepEqual(data.results[0].fields.fontName, { status: 'absent' });
  assert.deepEqual(data.results[1].fields.fontName, { status: 'mixed', value: { mixed: true } });
  assert.deepEqual(data.results[1].fields.characters, { status: 'value', value: 'mixed' });
});

test('readField marks throwing getters as unsupported', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  Object.defineProperty(rect, 'boomProp', { enumerable: true, get() { throw new Error('injected'); } });
  const data = success(await plugin.send('readField', { nodeIds: [rect.id], fields: ['boomProp', 'x'] }));
  assert.deepEqual(data.results[0].fields.boomProp, { status: 'unsupported' });
  assert.deepEqual(data.results[0].fields.x, { status: 'value', value: 0 });
});

test('readField truncates oversized strings and serialized values', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '汉'.repeat(17000) });
  const paint = {
    type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: Array.from({ length: 500 }, (_, i) => ({ position: i / 500, color: { r: 0.1, g: 0.2, b: 0.3 } })),
  };
  const rect = plugin.seed('RECTANGLE', { fills: [paint] });
  const data = success(await plugin.send('readField', { nodeIds: [text.id, rect.id], fields: ['characters', 'fills'] }));
  const chars = data.results[0].fields.characters;
  assert.equal(chars.status, 'truncated');
  assert.equal(chars.value.length, 16000);
  assert.equal(chars.valueLength, 17000);
  const fills = data.results[1].fields.fills;
  assert.equal(fills.status, 'truncated');
  assert.ok(fills.valueLength > 24000);
  assert.equal(fills.value, undefined);
});

test('readField keeps character ranges on UTF-16 boundaries', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '前🧪后' });
  const head = success(await plugin.send('readField', { nodeIds: [text.id], fields: ['characters'], range: { start: 0, end: 2 } }));
  const headField = head.results[0].fields.characters;
  assert.equal(headField.status, 'value');
  assert.equal(headField.value, '前');
  assert.equal(headField.actualStart, 0);
  assert.equal(headField.actualEnd, 1);
  const tail = success(await plugin.send('readField', { nodeIds: [text.id], fields: ['characters'], range: { start: 2, end: 4 } }));
  const tailField = tail.results[0].fields.characters;
  assert.equal(tailField.value, '🧪后');
  assert.equal(tailField.actualStart, 1);
  assert.equal(tailField.actualEnd, 4);
});

test('readField validates range usage', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'abc' });
  const rect = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [rect.id], fields: ['x'], range: { start: 0, end: 1 } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [text.id], fields: ['characters'], range: { start: 5, end: 2 } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [text.id], fields: ['characters'], range: { start: 0 } })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [text.id], fields: ['characters'], range: { start: -1, end: 1 } })).code, 'INVALID_PARAM');
});

test('readField rejects missing and foreign-page nodes', async () => {
  const plugin = await makePlugin();
  const foreign = plugin.seed('RECTANGLE', { name: 'elsewhere' }, plugin.pageB);
  assert.equal(failure(await plugin.send('readField', { nodeIds: ['nope:1'], fields: ['x'] })).code, 'NODE_NOT_FOUND');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [foreign.id], fields: ['x'] })).code, 'PAGE_CHANGED');
  assert.equal(failure(await plugin.send('readField', { nodeIds: [], fields: ['x'] })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('readField', { nodeIds: ['0:1'], fields: [] })).code, 'INVALID_PARAM');
});

// ---- getTextRuns ----------------------------------------------------------------

test('getTextRuns returns the first chunk with styled segments', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '你好世界' });
  const data = success(await plugin.send('getTextRuns', { id: text.id }));
  assert.equal(data.runs.length, 1);
  assert.deepEqual(data.runs[0].fontName, inter);
  assert.equal(data.runs[0].fontSize, 12);
  assert.equal(data.runs[0].characters, '你好世界');
  assert.equal(data.text, '你好世界');
  assert.equal(data.charactersLength, 4);
  assert.equal(data.nextOffset, null);
  assert.equal(typeof data.cursorId, 'string');
  assert.equal(data.contentDigest, simpleDigest('你好世界'));
});

test('getTextRuns rejects non-text targets', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('getTextRuns', { id: rect.id })).code, 'INVALID_TARGET');
  assert.equal(failure(await plugin.send('getTextRuns', { id: 'nope:1' })).code, 'NODE_NOT_FOUND');
});

test('getTextRuns chunks on UTF-16 boundaries without splitting surrogate pairs', async () => {
  const plugin = await makePlugin();
  const body = 'a'.repeat(15999) + '🧪' + 'b'.repeat(20);
  const text = plugin.seed('TEXT', { text: body });
  const first = success(await plugin.send('getTextRuns', { id: text.id }));
  assert.equal(first.nextOffset, 15999);
  assert.equal(first.text, 'a'.repeat(15999));
  assert.equal(first.charactersLength, 16021);
  const rest = success(await plugin.send('getTextRuns', { id: text.id, cursor: first.cursorId }));
  assert.equal(rest.text, '🧪' + 'b'.repeat(20));
  assert.equal(rest.nextOffset, null);
  assert.equal(first.text + rest.text, body);
  assert.equal(rest.charactersLength, 16021);
  const cjk = plugin.seed('TEXT', { text: '汉'.repeat(20000) });
  const cjkFirst = success(await plugin.send('getTextRuns', { id: cjk.id }));
  assert.equal(cjkFirst.nextOffset, 16000);
  const cjkRest = success(await plugin.send('getTextRuns', { id: cjk.id, cursor: cjkFirst.cursorId }));
  assert.equal(cjkRest.text, '汉'.repeat(4000));
  assert.equal(cjkRest.nextOffset, null);
});

test('getTextRuns invalidates continuation when the content changed', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'first version' });
  const first = success(await plugin.send('getTextRuns', { id: text.id }));
  text.seedText('second version');
  const error = failure(await plugin.send('getTextRuns', { id: text.id, cursor: first.cursorId }));
  assert.equal(error.code, 'CURSOR_EXPIRED');
});

test('getTextRuns continuation rejects unknown, stale and mismatched cursors', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'hello' });
  const frame = plugin.seed('FRAME');
  plugin.seed('RECTANGLE', {}, frame);
  const children = success(await plugin.send('getChildren', { id: frame.id }));
  assert.equal(failure(await plugin.send('getTextRuns', { id: text.id, cursor: '424242' })).code, 'CURSOR_NOT_FOUND');
  assert.equal(failure(await plugin.send('getTextRuns', { id: text.id, cursor: children.cursorId })).code, 'INVALID_PARAM');
  const first = success(await plugin.send('getTextRuns', { id: text.id }));
  plugin.switchPage(plugin.pageB);
  assert.equal(failure(await plugin.send('getTextRuns', { id: text.id, cursor: first.cursorId })).code, 'CURSOR_STALE');
});

test('getTextRuns marks segment reading as unsupported when the API throws', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'plain' });
  text.getStyledTextSegments = () => { throw new Error('injected'); };
  const data = success(await plugin.send('getTextRuns', { id: text.id }));
  assert.deepEqual(data.runs, []);
  assert.equal(data.runsUnsupported, true);
  assert.equal(data.text, 'plain');
  assert.equal(data.nextOffset, null);
});

test('getTextRuns truncates run lists at 200 segments', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'many' });
  text.getStyledTextSegments = () => Array.from({ length: 250 }, (_, i) => ({ characters: `s${i}`, start: i, end: i + 1 }));
  const data = success(await plugin.send('getTextRuns', { id: text.id }));
  assert.equal(data.runs.length, 200);
  assert.equal(data.runsTruncated, true);
});

// ---- getDesignContext -------------------------------------------------------------

test('getDesignContext summarizes page structure within the requested depth', async () => {
  const plugin = await makePlugin();
  const a = plugin.seed('FRAME', { name: 'A' });
  const b = plugin.seed('FRAME', { name: 'B' }); a.appendChild(b);
  const c = plugin.seed('FRAME', { name: 'C' }); b.appendChild(c);
  const d = plugin.seed('RECTANGLE', { name: 'D' }); c.appendChild(d);
  const data = success(await plugin.send('getDesignContext', {}));
  assert.equal(data.scope, 'page');
  assert.deepEqual(data.include, ['layout', 'bounds', 'text', 'components', 'variables', 'styles', 'assets']);
  assert.equal(data.depth, 2);
  assert.deepEqual(data.nodes.map(n => n.id), [a.id]);
  const bInfo = data.nodes[0].children[0];
  const cInfo = bInfo.children[0];
  assert.equal(bInfo.id, b.id);
  assert.equal(cInfo.id, c.id);
  assert.equal(cInfo.childrenCount, 1);
  assert.equal(cInfo.children, undefined);
  assert.equal(data.nodes[0].layout.width, 100);
  assert.ok(data.nodes[0].readErrors.includes('absoluteBoundingBox'));
  assert.equal(data.truncated, false);
});

test('getDesignContext filters layers by include', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '标题'.repeat(100) });
  const data = success(await plugin.send('getDesignContext', { scope: 'node', id: text.id, include: ['layout'] }));
  const info = data.nodes[0];
  assert.ok(info.layout);
  assert.equal(info.readErrors, undefined);
  assert.equal(info.text, undefined);
  const withText = success(await plugin.send('getDesignContext', { scope: 'node', id: text.id, include: ['text'] }));
  const textInfo = withText.nodes[0];
  assert.equal(textInfo.text.charactersLength, 200);
  assert.equal(typeof textInfo.text.characters, 'object');
  assert.equal(textInfo.layout, undefined);
});

test('getDesignContext reports bounds only when the host provides them', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE', { name: 'with-bounds' });
  rect.absoluteBoundingBox = { x: 1, y: 2, width: 30, height: 40 };
  const data = success(await plugin.send('getDesignContext', { scope: 'node', id: rect.id, include: ['bounds'] }));
  assert.deepEqual(data.nodes[0].bounds, { x: 1, y: 2, width: 30, height: 40 });
  assert.equal(data.nodes[0].readErrors, undefined);
  const bare = plugin.seed('RECTANGLE', { name: 'no-bounds' });
  const bareData = success(await plugin.send('getDesignContext', { scope: 'node', id: bare.id, include: ['bounds'] }));
  assert.deepEqual(bareData.nodes[0].readErrors, ['absoluteBoundingBox']);
  assert.equal(bareData.nodes[0].bounds, undefined);
});

test('getDesignContext reports components, variables, styles and assets', async () => {
  const plugin = await makePlugin();
  const instance = plugin.seed('INSTANCE', { name: 'primary-btn', componentId: 'C:1', key: 'K1', variantProperties: { Size: 'L' } });
  const component = plugin.seed('COMPONENT', { name: 'base-btn', key: 'K2' });
  const bound = plugin.seed('RECTANGLE', { name: 'bound' });
  bound.boundVariables = { visible: { type: 'VARIABLE_ALIAS', id: 'VariableId:1' }, fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableId:2' }] };
  bound.fillStyleId = 'S:1';
  bound.strokeStyleId = null;
  const image = plugin.seed('RECTANGLE', { name: 'pic', fills: [{ type: 'IMAGE', imageHash: 'hash-1', scaleMode: 'FILL' }] });
  const data = success(await plugin.send('getDesignContext', { scope: 'page', include: ['components', 'variables', 'styles', 'assets'] }));
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  assert.deepEqual(byId.get(instance.id).component, { componentId: 'C:1', name: 'primary-btn', componentKey: 'K1', variantProperties: { Size: 'L' } });
  assert.deepEqual(byId.get(component.id).component, { componentId: component.id, componentKey: 'K2' });
  assert.deepEqual(byId.get(bound.id).variables, [
    { field: 'visible', variableId: 'VariableId:1' },
    { field: 'fills', variableId: 'VariableId:2' },
  ]);
  assert.deepEqual(byId.get(bound.id).styles, { fillStyleId: 'S:1' });
  assert.deepEqual(byId.get(image.id).assets, [{ imageHash: 'hash-1', scaleMode: 'FILL' }]);
});

test('getDesignContext validates scope, include and target', async () => {
  const plugin = await makePlugin();
  const rect = plugin.seed('RECTANGLE');
  assert.equal(failure(await plugin.send('getDesignContext', { scope: 'node' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('getDesignContext', { scope: 'node', id: 'nope:1' })).code, 'NODE_NOT_FOUND');
  assert.equal(failure(await plugin.send('getDesignContext', { include: ['nope'] })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('getDesignContext', { depth: 7 })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('getDesignContext', { scope: 'galaxy' })).code, 'INVALID_PARAM');
  const data = success(await plugin.send('getDesignContext', { scope: 'node', id: rect.id, depth: 0 }));
  assert.deepEqual(data.nodes.map(n => n.id), [rect.id]);
  assert.equal(data.nodes[0].children, undefined);
});

test('getDesignContext sheds layers and truncates the node list under the size budget', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME', { name: 'huge' });
  for (let i = 0; i < 2500; i += 1) plugin.seed('RECTANGLE', { name: `n${i}` }, frame);
  const data = success(await plugin.send('getDesignContext', {}));
  assert.equal(data.truncated, true);
  assert.deepEqual(data.include, ['layout']);
  assert.deepEqual(data.droppedLayers, ['assets', 'styles', 'variables', 'text', 'components', 'bounds']);
  assert.ok(data.nodes.length >= 1);
  assert.ok(JSON.stringify(data).length <= 200 * 1024);
});
