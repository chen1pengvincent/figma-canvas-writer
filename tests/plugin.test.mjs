import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// This suite executes the actual plugin in memory. It neither connects to Figma
// nor proves Figma runtime compatibility; strict fixtures check API contracts.
const pluginUrl = new URL('../plugin/code.js', import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
const fontKey = (font) => `${font.family}::${font.style}`;
const inter = { family: 'Inter', style: 'Regular' };
const test = (name, callback) => nodeTest(name, { timeout: 4000 }, callback);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function makePlugin() {
  const nodes = new Map();
  const messages = [];
  const mutations = [];
  const fontLoads = [];
  const loadedFonts = new Set();
  const missingFonts = new Set();
  const fontGates = new Map();
  const events = new Map();
  const replies = new Map();
  const storage = new Map();
  const init = deferred();
  const mixed = Symbol('figma.mixed');
  let nodeSequence = 10;
  let messageSequence = 0;
  let currentPage;
  let recording = false;

  const pageIdOf = (node) => {
    let current = node;
    while (current && current.type !== 'PAGE') current = current.parent;
    return current?.id ?? null;
  };
  const record = (node, prop, value) => {
    if (recording) mutations.push({ nodeId: node.id, pageId: pageIdOf(node), prop, value: plain(value) });
  };

  function makeNode(type, id = `1:${++nodeSequence}`) {
    const node = { id, type, parent: null, removed: false, faults: {}, resizeCalls: [] };
    const values = {
      name: type, x: 0, y: 0, width: 100, height: type === 'LINE' ? 0 : 100,
      rotation: 0, opacity: 1, visible: true, fills: [], strokes: [],
      strokeWeight: 1, cornerRadius: 0,
    };
    for (const key of Object.keys(values)) {
      Object.defineProperty(node, key, {
        enumerable: true,
        get: () => values[key],
        set(value) {
          if (node.faults[key]) throw new Error(`Injected ${key} failure`);
          if (key === 'fills' || key === 'strokes') {
            for (const paint of value) {
              if (paint.type === 'SOLID') {
                assert.deepEqual(Object.keys(paint.color).sort(), ['b', 'g', 'r'], 'SolidPaint.color is RGB');
                for (const channel of Object.values(paint.color)) assert.ok(channel >= 0 && channel <= 1);
              }
            }
          }
          values[key] = value;
          record(node, key, value);
        },
      });
    }
    if (['DOCUMENT', 'PAGE', 'FRAME'].includes(type)) {
      node.children = [];
      node.appendChild = (child) => {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = node;
        node.children.push(child);
        record(child, 'parent', node.id);
      };
    }
    if (type === 'PAGE') {
      node.selection = [];
      node.loadAsync = async () => {};
    }
    node.resize = (width, height) => {
      node.resizeCalls.push([width, height]);
      if (node.faults.resize) throw new Error('Injected resize failure');
      assert.ok(Number.isFinite(width) && width > 0);
      assert.ok(type === 'LINE' ? height === 0 : Number.isFinite(height) && height > 0);
      values.width = width;
      values.height = height;
      record(node, 'size', [width, height]);
    };
    node.remove = () => {
      record(node, 'remove', true);
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
      node.removed = true;
      nodes.delete(node.id);
    };
    if (type === 'TEXT') {
      let text = '';
      let fonts = [{ ...inter }];
      let fontSize = 12;
      const requireFonts = (required = fonts) => {
        for (const font of required) {
          if (!loadedFonts.has(fontKey(font))) throw new Error(`Font not loaded: ${fontKey(font)}`);
        }
      };
      Object.defineProperties(node, {
        characters: {
          enumerable: true, get: () => text,
          set(value) { requireFonts(); text = value; record(node, 'characters', value); },
        },
        fontName: {
          enumerable: true, get: () => fonts.length === 1 ? fonts[0] : mixed,
          set(value) { requireFonts([value]); fonts = [plain(value)]; record(node, 'fontName', value); },
        },
        fontSize: {
          enumerable: true, get: () => fontSize,
          set(value) { requireFonts(); fontSize = value; record(node, 'fontSize', value); },
        },
        hasMissingFont: { get: () => fonts.some((font) => missingFonts.has(fontKey(font))) },
      });
      node.getRangeAllFontNames = (start, end) => {
        assert.ok(start >= 0 && end >= start && end <= text.length, 'font ranges must fit characters');
        return fonts.map((font) => ({ ...font }));
      };
      node.seedText = (value, initialFonts = [inter]) => { text = value; fonts = initialFonts.map((font) => ({ ...font })); };
    }
    nodes.set(id, node);
    return node;
  }

  const root = makeNode('DOCUMENT', '0:0');
  root.name = 'VM fixture design';
  const pageA = makeNode('PAGE', '0:1');
  const pageB = makeNode('PAGE', '0:2');
  pageA.name = 'Page A';
  pageB.name = 'Page B';
  root.appendChild(pageA);
  root.appendChild(pageB);
  currentPage = pageA;
  const figma = {
    root, mixed, editorType: 'figma', mode: 'default',
    ui: {
      onmessage: null,
      postMessage(value) {
        const message = plain(value);
        messages.push(message);
        if (message.context?.sessionId) init.resolve(message.context);
        if (message.type === 'exec_result') replies.get(message.id)?.resolve(message);
      },
    },
    showUI() {},
    notify() {},
    closePlugin() {},
    on(event, handler) { events.set(event, [...(events.get(event) ?? []), handler]); },
    off(event, handler) { events.set(event, (events.get(event) ?? []).filter((item) => item !== handler)); },
    getNodeByIdAsync: async (id) => nodes.get(id) ?? null,
    async loadFontAsync(font) {
      const key = fontKey(font);
      fontLoads.push(key);
      const gate = fontGates.get(key);
      if (gate) { gate.started.resolve(); await gate.release.promise; }
      if (missingFonts.has(key)) throw new Error(`Missing font: ${key}`);
      loadedFonts.add(key);
    },
    clientStorage: {
      getAsync: async (key) => storage.get(key),
      setAsync: async (key, value) => { storage.set(key, value); },
      deleteAsync: async (key) => { storage.delete(key); },
    },
    commitUndo() {},
  };
  Object.defineProperty(figma, 'currentPage', {
    get: () => currentPage,
    set() { throw new Error('dynamic-page: currentPage is read-only'); },
  });
  for (const type of ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR']) {
    const method = `create${type[0]}${type.slice(1).toLowerCase()}`;
    figma[method] = () => {
      const node = makeNode(type);
      currentPage.appendChild(node);
      record(node, 'create', type);
      return node;
    };
  }
  const sandbox = vm.createContext({ figma, __html__: '', console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout });
  vm.runInContext(await readFile(pluginUrl, 'utf8'), sandbox, { filename: 'plugin/code.js', timeout: 1000 });
  const initTimer = setTimeout(() => init.reject(new Error('Plugin did not publish startup context')), 1000);
  let context;
  try { context = await init.promise; }
  finally { clearTimeout(initTimer); }
  recording = true;

  async function send(command, params = {}, overrides = {}) {
    const id = ++messageSequence;
    const reply = deferred();
    replies.set(id, reply);
    const envelope = {
      type: 'exec', id, sessionId: context.sessionId, pageId: context.pageId,
      operationId: `test-operation-${id}`, command, params, ...overrides,
    };
    // Real Figma UI messages are deserialized in the plugin realm. Preserve that
    // contract so prototype checks are tested without cross-realm false failures.
    sandbox.serializedMessage = JSON.stringify(envelope);
    vm.runInContext('figma.ui.onmessage(JSON.parse(serializedMessage))', sandbox, { timeout: 1000 });
    const timer = setTimeout(() => reply.reject(new Error(`No reply for ${command} (${id})`)), 1500);
    try { return await reply.promise; }
    finally { clearTimeout(timer); replies.delete(id); }
  }

  return {
    context, send, nodes, messages, mutations, fontLoads, missingFonts, pageA, pageB,
    async post(message) {
      sandbox.serializedMessage = JSON.stringify(message);
      await vm.runInContext('figma.ui.onmessage(JSON.parse(serializedMessage))', sandbox, { timeout: 1000 });
    },
    seed(type, props = {}, page = pageA) {
      recording = false;
      const node = makeNode(type);
      page.appendChild(node);
      const { text, fonts, ...attributes } = props;
      Object.assign(node, attributes);
      if (type === 'TEXT') node.seedText(text ?? '', fonts ?? [inter]);
      recording = true;
      return node;
    },
    switchPage(page) {
      currentPage = page;
      for (const handler of events.get('currentpagechange') ?? []) handler();
    },
    holdFont(font = inter) {
      const gate = { started: deferred(), release: deferred() };
      fontGates.set(fontKey(font), gate);
      return { started: gate.started.promise, release: () => gate.release.resolve() };
    },
  };
}

function success(response) {
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.data;
}

function failure(response) {
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(typeof response.error?.code, 'string');
  return response.error;
}

test('setText preserves omitted content and clears only explicit empty text', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '保留原文' });
  success(await plugin.send('setText', { id: text.id, fontSize: 24 }));
  assert.equal(text.characters, '保留原文');
  assert.equal(text.fontSize, 24);
  success(await plugin.send('setText', { id: text.id, text: '' }));
  assert.equal(text.characters, '');
});

test('mixed-font edits load every existing font and preserve text', async () => {
  const plugin = await makePlugin();
  const otherFont = { family: 'Roboto', style: 'Bold' };
  const text = plugin.seed('TEXT', { text: 'mixed fonts', fonts: [inter, otherFont] });
  success(await plugin.send('setText', { id: text.id, fontSize: 28 }));
  assert.equal(text.characters, 'mixed fonts');
  assert.deepEqual([...new Set(plugin.fontLoads)].sort(), [fontKey(inter), fontKey(otherFont)].sort());
});

test('position-only text changes do not require unavailable fonts', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: '缺失字体仍可移动' });
  plugin.missingFonts.add(fontKey(inter));
  success(await plugin.send('setText', { id: text.id, x: 42, y: 16 }));
  assert.equal(text.characters, '缺失字体仍可移动');
  assert.equal(text.x, 42);
  assert.equal(plugin.fontLoads.length, 0);
});

test('an explicit replacement font can repair text whose old font is missing', async () => {
  const plugin = await makePlugin();
  const oldFont = { family: 'Unavailable Font', style: 'Regular' };
  const text = plugin.seed('TEXT', { text: 'repair font', fonts: [oldFont] });
  plugin.missingFonts.add(fontKey(oldFont));
  success(await plugin.send('setText', { id: text.id, fontName: inter, fontSize: 24 }));
  assert.equal(text.characters, 'repair font');
  assert.equal(text.fontSize, 24);
  assert.deepEqual(plain(text.fontName), inter);
  assert.deepEqual(plugin.fontLoads, [fontKey(inter)]);
});

test('mismatched or absent session/page targets reject writes without canvas mutation', async () => {
  const plugin = await makePlugin();
  for (const overrides of [
    { sessionId: 'other-session' }, { pageId: plugin.pageB.id },
    { sessionId: undefined }, { pageId: undefined },
  ]) failure(await plugin.send('createNode', { type: 'RECTANGLE' }, overrides));
  assert.equal(plugin.pageA.children.length, 0);
  assert.equal(plugin.pageB.children.length, 0);
  assert.equal(plugin.mutations.length, 0);
});

test('a node on a different page is rejected without switching the current page', async () => {
  const plugin = await makePlugin();
  const rectangle = plugin.seed('RECTANGLE', { name: 'other page' }, plugin.pageB);
  failure(await plugin.send('modifyNode', { id: rectangle.id, props: { name: 'wrong' } }));
  assert.equal(rectangle.name, 'other page');
  assert.equal(plugin.mutations.length, 0);
});

test('creating text with unavailable font fails without a leftover node', async () => {
  const plugin = await makePlugin();
  plugin.missingFonts.add(fontKey(inter));
  const error = failure(await plugin.send('createNode', { type: 'TEXT', text: 'cannot render' }));
  assert.ok(['not_started', 'rolled_back'].includes(error.state), JSON.stringify(error));
  assert.equal(plugin.pageA.children.length, 0);
  assert.equal(plugin.pageB.children.length, 0);
});

test('modify failure reports the actual partial or compensated state', async () => {
  const plugin = await makePlugin();
  const rectangle = plugin.seed('RECTANGLE', { name: 'before' });
  rectangle.faults.resize = true;
  const error = failure(await plugin.send('modifyNode', { id: rectangle.id, props: { name: 'after', width: 240 } }));
  assert.equal(rectangle.width, 100);
  if (rectangle.name === 'after') {
    assert.ok(['partial', 'unknown'].includes(error.state), JSON.stringify(error));
    assert.ok(error.affectedNodeIds?.includes(rectangle.id), JSON.stringify(error));
  } else {
    assert.equal(rectangle.name, 'before');
    assert.ok(['not_started', 'rolled_back'].includes(error.state), JSON.stringify(error));
  }
});

test('LINE creation and modification resize width with zero height', async () => {
  const plugin = await makePlugin();
  const created = success(await plugin.send('createNode', { type: 'LINE', width: 320 }));
  const line = plugin.nodes.get(created.id);
  assert.equal(line.width, 320);
  assert.deepEqual(line.resizeCalls.at(-1), [320, 0]);
  success(await plugin.send('modifyNode', { id: line.id, props: { width: 180 } }));
  assert.equal(line.width, 180);
  assert.deepEqual(line.resizeCalls.at(-1), [180, 0]);
});

test('SOLID opacity/visibility survive writes and can be read back', async () => {
  const plugin = await makePlugin();
  const paint = { type: 'SOLID', color: '#336699', opacity: 0.25, visible: false };
  const created = success(await plugin.send('createNode', { type: 'RECTANGLE', props: { fills: [paint] } }));
  const expected = { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 }, opacity: 0.25, visible: false };
  assert.deepEqual(plain(plugin.nodes.get(created.id).fills), [expected]);
  const readback = success(await plugin.send('getNodeInfo', { id: created.id }));
  assert.deepEqual(readback.fills, [expected]);
});

test('getContext discovers top-level children with empty selection and explicit pagination', async () => {
  const plugin = await makePlugin();
  const expected = Array.from({ length: 5 }, (_, index) => plugin.seed('RECTANGLE', { name: `top-${index}` }).id);
  assert.deepEqual(plugin.pageA.selection, []);
  const found = [];
  let cursor;
  for (let page = 0; page < 3; page += 1) {
    const data = success(await plugin.send('getContext', { limit: 2, ...(cursor == null ? {} : { cursor }) }));
    for (const field of ['sessionId', 'pageId', 'pageName', 'fileName']) {
      assert.equal(data[field], plugin.context[field]);
    }
    assert.equal(data.total, 5);
    assert.ok(data.nodes.length <= 2);
    found.push(...data.nodes.map((node) => node.id));
    assert.equal(data.truncated, page < 2);
    cursor = data.nextCursor;
    if (page < 2) assert.notEqual(cursor, null);
  }
  assert.equal(cursor, null);
  assert.deepEqual(found, expected);
  assert.equal(plugin.mutations.length, 0, 'context discovery must remain read-only');
});

test('large-text context pages obey the transport budget without silently losing nodes', async () => {
  const plugin = await makePlugin();
  const expected = Array.from({ length: 50 }, () => plugin.seed('TEXT', { text: '汉'.repeat(16000) }).id);
  const found = [];
  let cursor;
  for (let page = 0; page < expected.length; page += 1) {
    const response = await plugin.send('getContext', { limit: 50, ...(cursor == null ? {} : { cursor }) });
    const data = success(response);
    assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= 256 * 1024, 'aggregate response exceeds the WebSocket frame budget');
    assert.ok(data.nodes.length > 0, 'pagination must make progress');
    found.push(...data.nodes.map((node) => node.id));
    cursor = data.nextCursor;
    if (cursor === null) break;
    assert.equal(data.truncated, true);
  }
  assert.equal(cursor, null);
  assert.deepEqual(found, expected);
  assert.equal(plugin.mutations.length, 0);
});

test('large descendant readback stays bounded and marks omitted content', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  for (let index = 0; index < 20; index += 1) {
    const text = plugin.seed('TEXT', { text: '汉'.repeat(16000) });
    frame.appendChild(text);
  }
  const response = await plugin.send('getNodeInfo', { id: frame.id, depth: 1 });
  const data = success(response);
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= 256 * 1024, 'node response exceeds the WebSocket frame budget');
  assert.equal(data.childrenCount, 20);
  assert.equal(data.truncated, true);
});

test('a large existing node name cannot escape the response budget', async () => {
  const plugin = await makePlugin();
  const name = '名'.repeat(100000);
  const rectangle = plugin.seed('RECTANGLE', { name });
  const response = await plugin.send('getNodeInfo', { id: rectangle.id });
  const data = success(response);
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= 256 * 1024, 'node name bypassed the response budget');
  assert.ok(data.name.length < name.length);
  assert.equal(data.nameTruncated, true);
  assert.equal(data.nameLength, name.length);
});

test('context metadata cannot escape the response budget', async () => {
  const plugin = await makePlugin();
  plugin.pageA.name = '页'.repeat(100000);
  const response = await plugin.send('getContext');
  const data = success(response);
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= 256 * 1024, 'page name bypassed the response budget');
  assert.ok(data.pageName.length < plugin.pageA.name.length);
  assert.equal(data.pageNameTruncated, true);
});

test('identical operation IDs reuse the result, changed payload is rejected, status is queryable', async () => {
  const plugin = await makePlugin();
  const operationId = 'deduplicated-create';
  const params = { type: 'RECTANGLE', name: 'once' };
  const first = success(await plugin.send('createNode', params, { operationId }));
  assert.equal(first.state, 'succeeded');
  assert.equal(first.operationId, operationId);
  assert.ok(first.affectedNodeIds.includes(first.id));
  const second = success(await plugin.send('createNode', params, { operationId }));
  assert.equal(second.id, first.id);
  assert.equal(plugin.pageA.children.length, 1);
  assert.equal(failure(await plugin.send('createNode', { ...params, name: 'different' }, { operationId })).code, 'OPERATION_CONFLICT');
  assert.equal(plugin.pageA.children.length, 1);
  assert.equal(plugin.nodes.get(first.id).name, 'once');
  const operation = success(await plugin.send('getOperation', { operationId }));
  assert.equal(operation.state, 'succeeded');
});

test('concurrent duplicate writes share one in-flight operation', async () => {
  const plugin = await makePlugin();
  const font = plugin.holdFont();
  const params = { type: 'TEXT', text: 'once' };
  const first = plugin.send('createNode', params, { operationId: 'in-flight' });
  await font.started;
  const second = plugin.send('createNode', params, { operationId: 'in-flight' });
  font.release();
  const results = await Promise.all([first, second]);
  assert.equal(success(results[0]).id, success(results[1]).id);
  assert.equal(plugin.pageA.children.length, 1);
});

test('operation status remains queryable while the write queue is blocked', async () => {
  const plugin = await makePlugin();
  const font = plugin.holdFont();
  const running = plugin.send('createNode', { type: 'TEXT', text: 'running' }, { operationId: 'running' });
  await font.started;
  const queued = plugin.send('createNode', { type: 'RECTANGLE' }, { operationId: 'queued' });
  assert.equal(success(await plugin.send('getOperation', { operationId: 'running' })).state, 'running');
  assert.equal(success(await plugin.send('getOperation', { operationId: 'queued' })).state, 'queued');
  font.release();
  (await Promise.all([running, queued])).forEach(success);
});

test('operation capacity rejects new writes without evicting a deduplication record', async () => {
  const plugin = await makePlugin();
  const params = { type: 'RECTANGLE', name: 'first' };
  const first = success(await plugin.send('createNode', params, { operationId: 'old-record' }));
  let capacityReached = false;
  for (let index = 0; index < 1001; index += 1) {
    const before = plugin.pageA.children.length;
    const response = await plugin.send('createNode', { type: 'RECTANGLE' });
    if (!response.ok) {
      const error = failure(response);
      assert.equal(error.code, 'OPERATION_CAPACITY');
      assert.equal(error.state, 'not_started');
      assert.equal(plugin.pageA.children.length, before);
      capacityReached = true;
      break;
    }
  }
  assert.equal(capacityReached, true);
  const beforeRetry = plugin.pageA.children.length;
  assert.equal(success(await plugin.send('createNode', params, { operationId: 'old-record' })).id, first.id);
  assert.equal(plugin.pageA.children.length, beforeRetry);
});

test('a full queue of large readbacks rechecks memory capacity before every write', async () => {
  const plugin = await makePlugin();
  const paint = {
    type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: Array.from({ length: 210 }, (_, index) => ({
      position: index / 210, color: { r: 0.123456, g: 0.234567, b: 0.345678, a: 0.456789 },
    })),
  };
  const text = plugin.seed('TEXT', { text: 'x'.repeat(16000), fills: [paint], strokes: [paint] });
  const font = plugin.holdFont();
  const queued = [plugin.send('setText', { id: text.id, fontSize: 20 })];
  await font.started;
  // At most 100 writes: this is within the bridge's existing pending limit.
  for (let index = 1; index < 100; index += 1) {
    queued.push(plugin.send('setText', { id: text.id, fontSize: 20 + index }));
  }
  font.release();
  const responses = await Promise.all(queued);
  const rejected = responses.filter((response) => !response.ok);
  assert.ok(rejected.length > 0, 'queued requests exceeded the 8 MiB record budget without rejecting a later write');
  for (const response of rejected) {
    assert.equal(response.error.code, 'OPERATION_CAPACITY');
    assert.equal(response.error.state, 'not_started');
  }
  assert.ok(text.fontSize < 119, 'writes continued after result storage capacity was exhausted');
});

test('slow-font and queued writes cannot mutate another page after user navigation', async () => {
  const plugin = await makePlugin();
  const font = plugin.holdFont();
  const first = plugin.send('createNode', { type: 'TEXT', text: 'old page' });
  await font.started;
  const second = plugin.send('createNode', { type: 'RECTANGLE', name: 'queued' });
  plugin.switchPage(plugin.pageB);
  font.release();
  const responses = await Promise.all([first, second]);
  responses.forEach(failure);
  assert.equal(plugin.pageB.children.length, 0);
  assert.equal(plugin.pageA.children.length, 0);
  assert.equal(plugin.mutations.filter((mutation) => mutation.pageId === plugin.pageB.id).length, 0);
});

test('revocation invalidates in-flight and queued writes before canvas mutation', async () => {
  const plugin = await makePlugin();
  const font = plugin.holdFont();
  const first = plugin.send('createNode', { type: 'TEXT', text: 'revoked' });
  await font.started;
  const second = plugin.send('createNode', { type: 'RECTANGLE', name: 'revoked queue' });
  await plugin.post({ type: 'revoke' });
  font.release();
  const responses = await Promise.all([first, second]);
  responses.forEach(failure);
  assert.equal(plugin.pageA.children.length, 0);
  assert.equal(plugin.mutations.length, 0);
  const current = plugin.messages.filter((message) => message.type === 'context').at(-1).context;
  assert.notEqual(current.sessionId, plugin.context.sessionId);
});

test('moving a text node to another page during font loading prevents the delayed edit', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'before' });
  const font = plugin.holdFont();
  const pending = plugin.send('setText', { id: text.id, text: 'wrong page' });
  await font.started;
  // Model another editor moving the target without navigating this editor.
  plugin.pageB.appendChild(text);
  const marker = plugin.mutations.length;
  font.release();
  assert.equal(failure(await pending).state, 'not_started');
  assert.equal(text.characters, 'before');
  assert.equal(plugin.mutations.slice(marker).length, 0);
});

test('moving a text node during resize font loading rejects before mutation or foreign-page readback', async () => {
  const plugin = await makePlugin();
  const text = plugin.seed('TEXT', { text: 'before resize' });
  const font = plugin.holdFont();
  const pending = plugin.send('modifyNode', { id: text.id, props: { name: 'wrong page', width: 240 } });
  await font.started;
  plugin.pageB.appendChild(text);
  const marker = plugin.mutations.length;
  font.release();
  const error = failure(await pending);
  assert.equal(error.state, 'not_started');
  assert.equal(error.details?.readBack, undefined);
  assert.equal(text.name, 'TEXT');
  assert.equal(text.width, 100);
  assert.equal(plugin.mutations.slice(marker).length, 0);
});

test('moving a parent frame during font loading prevents creation under a different page', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const font = plugin.holdFont();
  const pending = plugin.send('createNode', { type: 'TEXT', text: 'wrong parent', parentId: frame.id });
  await font.started;
  plugin.pageB.appendChild(frame);
  const marker = plugin.mutations.length;
  font.release();
  failure(await pending);
  assert.equal(frame.children.length, 0);
  assert.equal(plugin.mutations.slice(marker).length, 0);
});
