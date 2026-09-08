import assert from 'node:assert/strict';
import { makePlugin, success, failure, test, inter, fontKey } from './helpers/figma-vm.js';

// ---- shared fixtures ---------------------------------------------------------

function attachSlideContainer(slide) {
  slide.children = [];
  slide.appendChild = (child) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = slide;
    slide.children.push(child);
  };
  return slide;
}

function pageChildrenOfType(plugin, type) {
  return plugin.root.children.filter((node) => node.type === type);
}

// ---- editor gates ------------------------------------------------------------

test('figjam command is rejected outside FigJam editors without touching the canvas', async () => {
  const figmaEditor = await makePlugin();
  const writeGate = failure(await figmaEditor.send('figjam', { action: 'createSticky', x: 0, y: 0, text: 'x' }));
  assert.equal(writeGate.code, 'EDITOR_UNSUPPORTED', JSON.stringify(writeGate));
  const readGate = failure(await figmaEditor.send('figjam', { action: 'listNodes' }));
  assert.equal(readGate.code, 'EDITOR_UNSUPPORTED');
  assert.equal(figmaEditor.mutations.length, 0);
  assert.equal(figmaEditor.pageA.children.length, 0);

  const slidesEditor = await makePlugin({ editorType: 'slides' });
  const gate = failure(await slidesEditor.send('figjam', { action: 'createSticky', x: 0, y: 0, text: 'x' }));
  assert.equal(gate.code, 'EDITOR_UNSUPPORTED');
  assert.equal(slidesEditor.mutations.length, 0);
  assert.equal(slidesEditor.pageA.children.length, 0);
});

test('slides command is rejected outside Slides editors without touching the canvas', async () => {
  const figmaEditor = await makePlugin();
  const writeGate = failure(await figmaEditor.send('slides', { action: 'createSlide' }));
  assert.equal(writeGate.code, 'EDITOR_UNSUPPORTED', JSON.stringify(writeGate));
  const readGate = failure(await figmaEditor.send('slides', { action: 'listStructure' }));
  assert.equal(readGate.code, 'EDITOR_UNSUPPORTED');
  assert.equal(figmaEditor.mutations.length, 0);
  assert.equal(figmaEditor.root.children.length, 2);

  const figjamEditor = await makePlugin({ editorType: 'figjam' });
  const gate = failure(await figjamEditor.send('slides', { action: 'addContent', slideId: '1:2', content: { type: 'RECTANGLE' } }));
  assert.equal(gate.code, 'EDITOR_UNSUPPORTED');
  assert.equal(figjamEditor.mutations.length, 0);
  assert.equal(figjamEditor.root.children.length, 2);
});

// ---- figma_figjam ------------------------------------------------------------

test('createSticky creates a sticky with text, position and name, and reads it back', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const data = success(await plugin.send('figjam', {
    action: 'createSticky', x: 10, y: 20, text: '便签内容', name: '便签A',
  }));
  assert.equal(data.state, 'succeeded');
  const sticky = plugin.pageA.children.find((node) => node.type === 'STICKY');
  assert.ok(sticky, 'sticky must live on the current page');
  assert.equal(data.id, sticky.id);
  assert.equal(data.parentId, plugin.pageA.id);
  assert.equal(data.characters, '便签内容');
  assert.equal(data.name, '便签A');
  assert.equal(data.x, 10);
  assert.equal(data.y, 20);
  assert.equal(sticky.characters, '便签内容');
  assert.ok(data.affectedNodeIds.includes(sticky.id));
  assert.ok(plugin.mutations.some((m) => m.nodeId === sticky.id && m.prop === 'create'));
  assert.ok(plugin.mutations.some((m) => m.nodeId === sticky.id && m.prop === 'x'));
  assert.ok(plugin.fontLoads.includes(fontKey(inter)));
});

test('createSticky validates x/y/text and leaves no residue when the font cannot load', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const invalid = [{ y: 0, text: 'a' }, { x: 0, text: 'a' }, { x: 0, y: 0 }];
  for (const params of invalid) {
    const error = failure(await plugin.send('figjam', { action: 'createSticky', ...params }));
    assert.equal(error.code, 'INVALID_PARAM', JSON.stringify(error));
  }
  assert.equal(plugin.pageA.children.length, 0);
  assert.equal(plugin.mutations.length, 0);

  plugin.missingFonts.add(fontKey(inter));
  const fontError = failure(await plugin.send('figjam', { action: 'createSticky', x: 0, y: 0, text: 'a' }));
  assert.equal(fontError.code, 'FONT_NOT_LOADABLE', JSON.stringify(fontError));
  assert.equal(plugin.pageA.children.length, 0, 'font failure must not leave a sticky behind');
  assert.equal(plugin.mutations.length, 0);
});

test('createSticky writes through the text subnode when the runtime exposes one', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const subnodes = [];
  const original = plugin.figma.createSticky;
  plugin.figma.createSticky = () => {
    const node = original();
    const text = { characters: '' };
    node.text = text;
    subnodes.push(text);
    return node;
  };
  const data = success(await plugin.send('figjam', { action: 'createSticky', x: 0, y: 0, text: '子节点文本' }));
  assert.equal(subnodes[0].characters, '子节点文本');
  assert.equal(data.characters, undefined, 'readback follows the loose two-state: no node.characters here');
});

test('updateSticky rewrites sticky text and validates the target type', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const sticky = plugin.seed('STICKY');
  sticky.characters = '旧文本';
  const data = success(await plugin.send('figjam', { action: 'updateSticky', id: sticky.id, text: '新文本' }));
  assert.equal(data.characters, '新文本');
  assert.equal(sticky.characters, '新文本');
  assert.ok(data.affectedNodeIds.includes(sticky.id));

  const wrongType = failure(await plugin.send('figjam', { action: 'updateSticky', id: plugin.seed('FRAME').id, text: 'x' }));
  assert.equal(wrongType.code, 'INVALID_TARGET');
  const missing = failure(await plugin.send('figjam', { action: 'updateSticky', id: '9:9', text: 'x' }));
  assert.equal(missing.code, 'NODE_NOT_FOUND');
  const badParams = failure(await plugin.send('figjam', { action: 'updateSticky' }));
  assert.equal(badParams.code, 'INVALID_PARAM');
});

test('createShapeWithText creates a shape with text and applies shapeType when supported', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const data = success(await plugin.send('figjam', {
    action: 'createShapeWithText', x: 5, y: 6, text: '形状文字', shapeType: 'ELLIPSE',
  }));
  const shape = plugin.pageA.children.find((node) => node.type === 'SHAPE_WITH_TEXT');
  assert.ok(shape);
  assert.equal(data.id, shape.id);
  assert.equal(data.characters, '形状文字');
  assert.equal(shape.characters, '形状文字');
  assert.equal(shape.x, 5);
  assert.equal(shape.y, 6);

  const badShapeType = failure(await plugin.send('figjam', {
    action: 'createShapeWithText', x: 0, y: 0, text: 'x', shapeType: 'TRAPEZOID',
  }));
  assert.equal(badShapeType.code, 'INVALID_PARAM');

  const original = plugin.figma.createShapeWithText;
  plugin.figma.createShapeWithText = () => {
    const node = original();
    node.shapeType = 'SQUARE';
    return node;
  };
  success(await plugin.send('figjam', { action: 'createShapeWithText', x: 0, y: 0, text: 'x', shapeType: 'CLOUD' }));
  const shaped = plugin.pageA.children.filter((node) => node.type === 'SHAPE_WITH_TEXT').at(-1);
  assert.equal(shaped.shapeType, 'CLOUD');
});

test('createConnector binds endpoints and records the connectTo arguments', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const a = plugin.seed('STICKY');
  const b = plugin.seed('STICKY');
  const calls = [];
  const original = plugin.figma.createConnector;
  plugin.figma.createConnector = () => {
    const connector = original();
    connector.start = { connectTo: (node, magnet) => calls.push(['start', node.id, magnet]) };
    connector.end = { connectTo: (node, magnet) => calls.push(['end', node.id, magnet]) };
    return connector;
  };
  const data = success(await plugin.send('figjam', {
    action: 'createConnector', startNodeId: a.id, endNodeId: b.id,
    startMagnet: 'TOP', endMagnet: 'BOTTOM',
  }));
  assert.deepEqual(calls, [['start', a.id, 'TOP'], ['end', b.id, 'BOTTOM']]);
  assert.equal(data.startNodeId, a.id);
  assert.equal(data.endNodeId, b.id);
  assert.equal(data.startMagnet, 'TOP');
  assert.equal(data.endMagnet, 'BOTTOM');
  const connector = plugin.pageA.children.find((node) => node.type === 'CONNECTOR');
  assert.ok(connector);
  assert.ok(data.affectedNodeIds.includes(connector.id));

  calls.length = 0;
  success(await plugin.send('figjam', { action: 'createConnector', startNodeId: a.id, endNodeId: b.id }));
  assert.deepEqual(calls, [['start', a.id, undefined], ['end', b.id, undefined]]);
});

test('createConnector reports UNSUPPORTED when endpoints lack connectTo and rolls the connector back', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const a = plugin.seed('STICKY');
  const b = plugin.seed('STICKY');
  const original = plugin.figma.createConnector;
  plugin.figma.createConnector = () => {
    const connector = original();
    connector.start = {};
    return connector;
  };
  const before = plugin.pageA.children.length;
  const error = failure(await plugin.send('figjam', { action: 'createConnector', startNodeId: a.id, endNodeId: b.id }));
  assert.equal(error.code, 'UNSUPPORTED', JSON.stringify(error));
  assert.match(error.message, /连接线端点绑定/);
  assert.equal(plugin.pageA.children.length, before, 'failed connector must be removed');
});

test('createConnector validates that both endpoints exist on the current page', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const a = plugin.seed('STICKY');
  const missingEnd = failure(await plugin.send('figjam', { action: 'createConnector', startNodeId: a.id, endNodeId: '9:9' }));
  assert.equal(missingEnd.code, 'NODE_NOT_FOUND');
  const offPage = plugin.seed('STICKY', {}, plugin.pageB);
  const offPageError = failure(await plugin.send('figjam', { action: 'createConnector', startNodeId: a.id, endNodeId: offPage.id }));
  assert.equal(offPageError.code, 'PAGE_CHANGED');
  const missingParam = failure(await plugin.send('figjam', { action: 'createConnector', endNodeId: a.id }));
  assert.equal(missingParam.code, 'INVALID_PARAM');
  assert.equal(plugin.pageA.children.length, 1);
  assert.equal(plugin.mutations.length, 0, 'rejected connectors must not record mutations');
});

test('updateConnector writes textCharacters, text subnode or characters depending on the runtime', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });

  const bare = plugin.seed('CONNECTOR');
  const bareData = success(await plugin.send('figjam', { action: 'updateConnector', id: bare.id, text: '连线一' }));
  assert.equal(bareData.characters, '连线一');
  assert.equal(bare.characters, '连线一');

  const withTextCharacters = plugin.seed('CONNECTOR');
  withTextCharacters.textCharacters = '';
  success(await plugin.send('figjam', { action: 'updateConnector', id: withTextCharacters.id, text: '连线二' }));
  assert.equal(withTextCharacters.textCharacters, '连线二');

  const withText = plugin.seed('CONNECTOR');
  withText.text = { characters: '' };
  success(await plugin.send('figjam', { action: 'updateConnector', id: withText.id, text: '连线三' }));
  assert.equal(withText.text.characters, '连线三');

  const wrongType = failure(await plugin.send('figjam', { action: 'updateConnector', id: plugin.seed('STICKY').id, text: 'x' }));
  assert.equal(wrongType.code, 'INVALID_TARGET');
});

test('listNodes filters FigJam node types, paginates and truncates long text read-only', async () => {
  const plugin = await makePlugin({ editorType: 'figjam' });
  const sticky = plugin.seed('STICKY');
  sticky.characters = '便签一';
  const shape = plugin.seed('SHAPE_WITH_TEXT');
  shape.characters = 'x'.repeat(260);
  const connector = plugin.seed('CONNECTOR');
  plugin.seed('FRAME');
  plugin.seed('TEXT', { text: '普通文本' });

  const first = success(await plugin.send('figjam', { action: 'listNodes', limit: 2 }));
  assert.equal(first.total, 3);
  assert.equal(first.nodes.length, 2);
  assert.equal(first.nodes[0].id, sticky.id);
  assert.equal(first.nodes[0].type, 'STICKY');
  assert.equal(first.nodes[0].name, 'STICKY');
  assert.equal(first.nodes[0].characters, '便签一');
  assert.equal(first.nodes[0].truncated, undefined);
  assert.equal(first.nodes[1].characters.length, 200);
  assert.equal(first.nodes[1].truncated, true);
  assert.equal(first.nextCursor, '2');
  assert.equal(first.truncated, true);

  const second = success(await plugin.send('figjam', { action: 'listNodes', cursor: first.nextCursor }));
  assert.equal(second.nodes.length, 1);
  assert.equal(second.nodes[0].id, connector.id);
  assert.equal(second.nodes[0].type, 'CONNECTOR');
  assert.equal(second.nodes[0].characters, undefined);
  assert.equal(second.nextCursor, null);
  assert.equal(second.truncated, false);

  assert.equal(failure(await plugin.send('figjam', { action: 'listNodes', cursor: '9' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('figjam', { action: 'listNodes', cursor: 'abc' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('figjam', { action: 'listNodes', limit: 101 })).code, 'INVALID_PARAM');

  const mutationsBefore = plugin.mutations.length;
  success(await plugin.send('figjam', { action: 'listNodes' }));
  assert.equal(plugin.mutations.length, mutationsBefore, 'listNodes must stay read-only');
});

// ---- figma_slides ------------------------------------------------------------

test('listStructure descends page -> grid/rows/slides without touching it', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const data = success(await plugin.send('slides', { action: 'listStructure' }));
  assert.equal(data.truncated, false);
  assert.equal(data.structure[0].id, plugin.pageA.id);
  assert.equal(data.structure[0].type, 'PAGE');
  const mutationsBefore = plugin.mutations.length;
  success(await plugin.send('slides', { action: 'listStructure' }));
  assert.equal(plugin.mutations.length, mutationsBefore);
});

test('createSlide uses documented auto-placement; only order end is supported', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const first = success(await plugin.send('slides', { action: 'createSlide' }));
  assert.equal(first.type, 'SLIDE');
  const second = success(await plugin.send('slides', { action: 'createSlide', order: 'end' }));
  assert.equal(second.type, 'SLIDE');
  assert.equal(plugin.pageA.children.filter((node) => node.type === 'SLIDE').length, 2);
  assert.ok(second.affectedNodeIds.includes(second.id));
  assert.ok(plugin.mutations.some((m) => m.nodeId === second.id && m.prop === 'create'));

  const unsupported = failure(await plugin.send('slides', { action: 'createSlide', order: 'before', relativeToId: first.id }));
  assert.equal(unsupported.code, 'UNSUPPORTED');
  const missingRelative = failure(await plugin.send('slides', { action: 'createSlide', order: 'before' }));
  assert.equal(missingRelative.code, 'UNSUPPORTED');
});

test('createSlideRow auto-places into the deck and shows up in listStructure', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const data = success(await plugin.send('slides', { action: 'createSlideRow' }));
  assert.equal(data.type, 'SLIDE_ROW');
  const row = plugin.pageA.children.find((node) => node.type === 'SLIDE_ROW');
  assert.ok(row);
  assert.equal(data.id, row.id);
  const structure = success(await plugin.send('slides', { action: 'listStructure' }));
  assert.ok(structure.structure.some((item) => item.id === row.id && item.type === 'SLIDE_ROW'));
});

test('addContent creates content on the slide with props and fills applied', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const slideData = success(await plugin.send('slides', { action: 'createSlide' }));
  const slide = attachSlideContainer(plugin.pageA.children.find((node) => node.id === slideData.id));
  const data = success(await plugin.send('slides', {
    action: 'addContent', slideId: slide.id,
    content: { type: 'RECTANGLE', x: 5, y: 6, width: 80, height: 40, name: '方块', fills: [{ type: 'SOLID', color: '#FF0000' }] },
  }));
  assert.equal(data.state, 'succeeded');
  assert.equal(data.parentId, slide.id);
  assert.equal(data.x, 5);
  assert.equal(data.y, 6);
  assert.equal(data.width, 80);
  assert.equal(data.height, 40);
  assert.equal(data.name, '方块');
  assert.deepEqual(data.fills, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
  assert.ok(slide.children.some((node) => node.id === data.id), 'content must be re-parented onto the slide');
  assert.ok(plugin.mutations.some((m) => m.nodeId === data.id && m.prop === 'size'));
  assert.ok(plugin.mutations.some((m) => m.nodeId === data.id && m.prop === 'fills'));
});

test('addContent writes TEXT through the loaded font and leaves no residue on font failure', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const slideData = success(await plugin.send('slides', { action: 'createSlide' }));
  const slide = attachSlideContainer(plugin.pageA.children.find((node) => node.id === slideData.id));
  const data = success(await plugin.send('slides', {
    action: 'addContent', slideId: slide.id,
    content: { type: 'TEXT', x: 0, y: 0, width: 200, height: 40, text: '标题', fontSize: 24 },
  }));
  assert.equal(data.characters, '标题');
  assert.equal(data.fontSize, 24);
  const textNode = slide.children.find((node) => node.id === data.id);
  assert.ok(textNode);
  assert.equal(textNode.characters, '标题');
  assert.ok(plugin.fontLoads.includes(fontKey(inter)));

  plugin.missingFonts.add(fontKey(inter));
  const pageChildrenBefore = plugin.pageA.children.length;
  const mutationsBefore = plugin.mutations.length;
  const error = failure(await plugin.send('slides', {
    action: 'addContent', slideId: slide.id,
    content: { type: 'TEXT', x: 0, y: 0, width: 100, height: 30, text: '失败' },
  }));
  assert.equal(error.code, 'FONT_NOT_LOADABLE', JSON.stringify(error));
  assert.equal(plugin.pageA.children.length, pageChildrenBefore, 'font failure must not leave a node behind');
  assert.equal(plugin.mutations.length, mutationsBefore);
});

test('addContent validates the slide target and rolls back when the container cannot append', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const wrongType = failure(await plugin.send('slides', {
    action: 'addContent', slideId: plugin.seed('FRAME').id, content: { type: 'RECTANGLE' },
  }));
  assert.equal(wrongType.code, 'INVALID_TARGET');
  const missing = failure(await plugin.send('slides', {
    action: 'addContent', slideId: '9:9', content: { type: 'RECTANGLE' },
  }));
  assert.equal(missing.code, 'NODE_NOT_FOUND');
  const badContent = failure(await plugin.send('slides', {
    action: 'addContent', slideId: '1:2', content: { type: 'STAR' },
  }));
  assert.equal(badContent.code, 'INVALID_PARAM');

  const slideData = success(await plugin.send('slides', { action: 'createSlide' }));
  const slide = plugin.pageA.children.find((node) => node.id === slideData.id);
  const pageChildrenBefore = plugin.pageA.children.length;
  // Simulate an editor that refuses to host content nodes on the slide.
  const savedAppend = slide.appendChild;
  delete slide.appendChild;
  try {
    const unsupported = failure(await plugin.send('slides', {
      action: 'addContent', slideId: slide.id, content: { type: 'RECTANGLE' },
    }));
    assert.equal(unsupported.code, 'UNSUPPORTED', JSON.stringify(unsupported));
    assert.match(unsupported.message, /向幻灯片添加内容/);
    assert.equal(plugin.pageA.children.length, pageChildrenBefore, 'failed content must be rolled back');
    assert.equal([...plugin.nodes.values()].filter((node) => node.type === 'RECTANGLE').length, 0);
  } finally {
    slide.appendChild = savedAppend;
  }
});

test('updateContent applies a property subset, loads fonts for text and rejects unsupported props', async () => {
  const plugin = await makePlugin({ editorType: 'slides' });
  const slideData = success(await plugin.send('slides', { action: 'createSlide' }));
  const slide = attachSlideContainer(plugin.pageA.children.find((node) => node.id === slideData.id));
  const rect = success(await plugin.send('slides', {
    action: 'addContent', slideId: slide.id,
    content: { type: 'RECTANGLE', x: 1, y: 2, width: 50, height: 60, name: '原名' },
  }));
  const data = success(await plugin.send('slides', {
    action: 'updateContent', id: rect.id,
    content: { type: 'RECTANGLE', x: 9, name: '新名', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }] },
  }));
  assert.equal(data.x, 9);
  assert.equal(data.name, '新名');
  assert.deepEqual(data.fills, [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]);
  assert.equal(data.y, 2, 'properties outside the subset must stay untouched');
  assert.equal(data.width, 50);

  const text = success(await plugin.send('slides', {
    action: 'addContent', slideId: slide.id,
    content: { type: 'TEXT', x: 0, y: 0, width: 100, height: 30, text: '旧文' },
  }));
  const fontLoadsBefore = plugin.fontLoads.length;
  const textData = success(await plugin.send('slides', {
    action: 'updateContent', id: text.id,
    content: { type: 'TEXT', text: '新文', fontSize: 30 },
  }));
  assert.equal(textData.characters, '新文');
  assert.equal(textData.fontSize, 30);
  assert.ok(plugin.fontLoads.length > fontLoadsBefore, 'text updates must load node fonts');

  const unsupported = failure(await plugin.send('slides', {
    action: 'updateContent', id: rect.id, content: { type: 'RECTANGLE', text: 'x' },
  }));
  assert.equal(unsupported.code, 'UNSUPPORTED_PROPERTY', JSON.stringify(unsupported));
  assert.equal(plugin.nodes.get(rect.id).characters, undefined);
  const missing = failure(await plugin.send('slides', {
    action: 'updateContent', id: '9:9', content: { type: 'RECTANGLE', x: 0 },
  }));
  assert.equal(missing.code, 'NODE_NOT_FOUND');
});

// ---- capability discovery -----------------------------------------------------

test('capability report marks figjam/slides implemented only in their own editors', async () => {
  const figjamPlugin = await makePlugin({ editorType: 'figjam' });
  const figjamReport = success(await figjamPlugin.send('getCapabilities', {}));
  const figjamDomain = figjamReport.domains.find((domain) => domain.name === 'figjam');
  assert.equal(figjamDomain.status, 'implemented');
  assert.deepEqual(figjamDomain.actions, ['createSticky', 'updateSticky', 'createShapeWithText', 'createConnector', 'updateConnector', 'listNodes']);
  assert.equal(figjamDomain.preconditions[0], '需在已打开的 FigJam 文件中运行插件');
  assert.deepEqual(figjamDomain.notes, ['不提供 Mermaid 解析、自动图布局或官方图表生成服务', 'listNodes 为偏移式分页，不固定成员列表；跨页调用可能漂移']);
  assert.equal(figjamDomain.verified, false, 'real-canvas acceptance is pending');
  assert.equal(figjamReport.domains.find((domain) => domain.name === 'slides').status, 'editor-unsupported');

  const slidesPlugin = await makePlugin({ editorType: 'slides' });
  const slidesReport = success(await slidesPlugin.send('getCapabilities', {}));
  const slidesDomain = slidesReport.domains.find((domain) => domain.name === 'slides');
  assert.equal(slidesDomain.status, 'implemented');
  assert.deepEqual(slidesDomain.actions, ['listStructure', 'createSlide', 'createSlideRow', 'addContent', 'updateContent']);
  assert.equal(slidesDomain.preconditions[0], '需在已打开的 Slides 文件中运行插件');
  assert.deepEqual(slidesDomain.notes, ['不新建演示文件；不提供主题推导或模板库检索']);
  assert.equal(slidesReport.domains.find((domain) => domain.name === 'figjam').status, 'editor-unsupported');
});
