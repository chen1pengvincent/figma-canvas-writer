// Shared in-memory plugin harness. Executes the bundled plugin/code.js in a VM
// with a strict-but-extendable figma fixture. Domain test files extend the
// returned figma object locally instead of editing this helper.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const pluginUrl = process.env.FCW_PLUGIN_PATH
  ? new URL(`file://${process.env.FCW_PLUGIN_PATH}`)
  : new URL('../../plugin/code.js', import.meta.url);
export const plain = (value) => JSON.parse(JSON.stringify(value));
export const fontKey = (font) => `${font.family}::${font.style}`;
export const inter = { family: 'Inter', style: 'Regular' };
export const test = (name, callback) => nodeTest(name, { timeout: 8000 }, callback);

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function makePlugin(options = {}) {
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
  const exportResults = new Map();
  const images = [];
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
    if (recording) mutations.push({ nodeId: node.id, pageId: pageIdOf(node), prop, value: safeClone(value) });
  };
  function safeClone(value) {
    try { return plain(value); } catch { return String(value); }
  }

  function makeNode(type, id = `1:${++nodeSequence}`) {
    const node = { id, type, parent: null, removed: false, faults: {}, resizeCalls: [] };
    const values = {
      name: type, x: 0, y: 0, width: 100, height: type === 'LINE' ? 0 : 100,
      rotation: 0, opacity: 1, visible: true, locked: false,
      fills: [], strokes: [], strokeWeight: 1, cornerRadius: 0,
      effects: [], layoutGrids: [], clipsContent: true, isMask: false,
      blendMode: 'PASS_THROUGH', reactions: [],
    };
    if (type === 'POLYGON') values.pointCount = 5;
    if (type === 'STAR') { values.pointCount = 5; values.innerRadius = 0.382; }
    node.__values = values;
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
    if (['DOCUMENT', 'PAGE', 'FRAME', 'GROUP', 'SECTION', 'COMPONENT_SET', 'COMPONENT', 'BOOLEAN_OPERATION', 'SLIDE', 'SLIDE_ROW'].includes(type)) {
      node.children = [];
      node.appendChild = (child) => {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = node;
        node.children.push(child);
        record(child, 'parent', node.id);
      };
      node.insertChild = (index, child) => {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = node;
        node.children.splice(index, 0, child);
        record(child, 'parent', node.id);
      };
    }
    if (type === 'PAGE') {
      node.selection = [];
      node.loadAsync = async () => {};
      node.findAll = (fn) => node.children.filter(fn);
    }
    if (type === 'FRAME' || type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'GROUP') {
      node.findAll = (fn) => {
        const out = [];
        const walk = (n) => { for (const child of n.children || []) { if (fn(child)) out.push(child); walk(child); } };
        walk(node);
        return out;
      };
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
      node.getStyledTextSegments = (fields, start = 0, end = text.length) => ([{
        characters: text.slice(start, end), start, end,
        ...Object.fromEntries(fields.map(f => [f, f === 'fontName' ? { ...fonts[0] } : f === 'fontSize' ? fontSize : f === 'fills' ? [] : f === 'textCase' ? 'ORIGINAL' : f === 'textDecoration' ? 'NONE' : f === 'lineHeight' ? { unit: 'AUTO' } : f === 'letterSpacing' ? { unit: 'PIXELS', value: 0 } : null])),
      }]);
      node.seedText = (value, initialFonts = [inter]) => { text = value; fonts = initialFonts.map((font) => ({ ...font })); };
      node.__text = () => text;
    }
    if (type === 'VECTOR') {
      Object.defineProperties(node, {
        vectorNetwork: {
          enumerable: true, get: () => values.vectorNetwork,
          set(value) {
            assert.ok(value && Array.isArray(value.vertices) && Array.isArray(value.segments), 'vectorNetwork shape');
            values.vectorNetwork = plain(value);
            record(node, 'vectorNetwork', value);
          },
        },
        vectorPaths: {
          enumerable: true, get: () => values.vectorPaths,
          set(value) {
            assert.ok(Array.isArray(value), 'vectorPaths must be an array');
            values.vectorPaths = plain(value);
            record(node, 'vectorPaths', value);
          },
        },
      });
    }
    node.exportAsync = async (settings) => {
      record(node, 'export', plain(settings));
      const handler = exportResults.get('default') || (() => { throw new Error('No exportAsync result configured'); });
      const result = await handler(node, plain(settings));
      return result;
    };
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

  const variablesNamespace = options.variables || {
    getLocalVariableCollectionsAsync: async () => [],
    getVariableCollectionByIdAsync: async () => null,
    getLocalVariablesAsync: async () => [],
    getVariableByIdAsync: async () => null,
    createVariable: () => { throw new Error('not configured'); },
    createVariableCollection: () => { throw new Error('not configured'); },
    importVariableByKeyAsync: async () => { throw new Error('not configured'); },
  };
  const stylesFetchers = {
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
  const teamLibraryNamespace = {
    getAvailableLibraryVariableCollectionsAsync: async () => [],
    getVariablesInLibraryCollectionAsync: async () => { throw new Error('not configured'); },
  };

  const creatorFor = (type) => () => {
    const node = makeNode(type);
    currentPage.appendChild(node);
    record(node, 'create', type);
    return node;
  };
  const booleanOp = (operation, nodesToCombine, parent) => {
    assert.ok(['UNION', 'INTERSECT', 'SUBTRACT', 'EXCLUDE'].includes(operation), 'boolean operation kind');
    assert.ok(Array.isArray(nodesToCombine) && nodesToCombine.length >= 2, 'boolean op needs >= 2 nodes');
    const bool = makeNode('BOOLEAN_OPERATION');
    bool.booleanOperation = operation;
    for (const child of nodesToCombine) bool.appendChild(child);
    (parent || currentPage).appendChild(bool);
    return bool;
  };
  const figma = {
    root, mixed, editorType: options.editorType || 'figma', mode: 'default',
    fileKey: options.fileKey === undefined ? null : options.fileKey,
    variables: variablesNamespace,
    teamLibrary: teamLibraryNamespace,
    getLocalPaintStylesAsync: stylesFetchers.getLocalPaintStylesAsync,
    getLocalTextStylesAsync: stylesFetchers.getLocalTextStylesAsync,
    getLocalEffectStylesAsync: stylesFetchers.getLocalEffectStylesAsync,
    getLocalGridStylesAsync: stylesFetchers.getLocalGridStylesAsync,
    listAvailableShaders: async () => options.shaders || [],
    importShaderById: async () => { throw new Error('not configured'); },
    ui: {
      onmessage: null,
      postMessage(value) {
        const message = plain(value);
        messages.push(message);
        if (message.context?.sessionId) init.resolve(message.context);
        if (message.type === 'context' && message.context?.sessionId) contextRef.current = message.context;
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
    createRectangle: creatorFor('RECTANGLE'),
    createEllipse: creatorFor('ELLIPSE'),
    createText: creatorFor('TEXT'),
    createFrame: creatorFor('FRAME'),
    createLine: creatorFor('LINE'),
    createStar: creatorFor('STAR'),
    createPolygon: creatorFor('POLYGON'),
    createVector: creatorFor('VECTOR'),
    createSlice: creatorFor('SLICE'),
    createPage: () => makeNode('PAGE'),
    createComponent: creatorFor('COMPONENT'),
    createComponentFromNode: (node) => {
      const component = makeNode('COMPONENT');
      component.name = node.name;
      component.appendChild(node);
      currentPage.appendChild(component);
      return component;
    },
    createSticky: creatorFor('STICKY'),
    createConnector: creatorFor('CONNECTOR'),
    createShapeWithText: creatorFor('SHAPE_WITH_TEXT'),
    createSlide: creatorFor('SLIDE'),
    createSlideRow: creatorFor('SLIDE_ROW'),
    createBooleanOperation: () => makeNode('BOOLEAN_OPERATION'),
    union: (nodesToCombine, parent) => booleanOp('UNION', nodesToCombine, parent),
    subtract: (nodesToCombine, parent) => booleanOp('SUBTRACT', nodesToCombine, parent),
    intersect: (nodesToCombine, parent) => booleanOp('INTERSECT', nodesToCombine, parent),
    exclude: (nodesToCombine, parent) => booleanOp('EXCLUDE', nodesToCombine, parent),
    group: (nodesToGroup, parent) => {
      assert.ok(Array.isArray(nodesToGroup) && nodesToGroup.length >= 1, 'group needs nodes');
      const group = makeNode('GROUP');
      (parent || nodesToGroup[0].parent || currentPage).appendChild(group);
      for (const child of nodesToGroup) group.appendChild(child);
      return group;
    },
    ungroup: (group) => {
      const parent = group.parent;
      for (const child of [...group.children]) parent.appendChild(child);
      group.remove();
      return group.children;
    },
    combineAsVariants: (nodesToCombine, parent) => {
      const set = makeNode('COMPONENT_SET');
      (parent || currentPage).appendChild(set);
      for (const child of nodesToCombine) set.appendChild(child);
      return set;
    },
    createImage: (bytes) => {
      assert.ok(bytes instanceof Uint8Array, 'createImage needs bytes');
      const hash = 'img-' + images.length.toString(36).padStart(6, '0');
      images.push({ hash, bytes: bytes.length });
      return {
        hash,
        getSizeAsync: async () => options.imageSize || { width: 40, height: 30 },
      };
    },
    commitUndo() {},
  };
  figma.setCurrentPageAsync = async (page) => {
    assert.equal(page.type, 'PAGE');
    currentPage = page;
    for (const handler of events.get('currentpagechange') ?? []) handler();
  };
  Object.defineProperty(figma, 'currentPage', {
    get: () => currentPage,
    set() { throw new Error('dynamic-page: currentPage is read-only'); },
  });
  const sandbox = vm.createContext({ figma, __html__: '', console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout, TextEncoder, TextDecoder });
  vm.runInContext(await readFile(pluginUrl, 'utf8'), sandbox, { filename: 'plugin/code.js', timeout: 2000 });
  const initTimer = setTimeout(() => init.reject(new Error('Plugin did not publish startup context')), 2000);
  let context;
  try { context = await init.promise; }
  finally { clearTimeout(initTimer); }
  recording = true;

  const contextRef = { current: null };
  async function send(command, params = {}, overrides = {}) {
    const id = ++messageSequence;
    const reply = deferred();
    replies.set(id, reply);
    const latest = contextRef.current || context;
    const envelope = {
      type: 'exec', id, sessionId: latest.sessionId, pageId: latest.pageId,
      pageRevision: latest.pageRevision,
      operationId: `test-operation-${id}`, command, params, ...overrides,
    };
    sandbox.serializedMessage = JSON.stringify(envelope);
    vm.runInContext('figma.ui.onmessage(JSON.parse(serializedMessage))', sandbox, { timeout: 4000 });
    const timer = setTimeout(() => reply.reject(new Error(`No reply for ${command} (${id})`)), 4000);
    try { return await reply.promise; }
    finally { clearTimeout(timer); replies.delete(id); }
  }

  return {
    context, send, nodes, messages, mutations, fontLoads, missingFonts, pageA, pageB, root,
    figma, images, exportResults, sandbox, nodesMap: nodes, contextRef,
    async post(message) {
      sandbox.serializedMessage = JSON.stringify(message);
      await vm.runInContext('figma.ui.onmessage(JSON.parse(serializedMessage))', sandbox, { timeout: 4000 });
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

export function success(response) {
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.data;
}

export function failure(response) {
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(typeof response.error?.code, 'string');
  return response.error;
}
