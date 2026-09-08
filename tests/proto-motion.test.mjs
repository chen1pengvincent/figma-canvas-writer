import assert from 'node:assert/strict';
import { makePlugin, success, failure, plain, test } from './helpers/figma-vm.js';

// ---- fixtures ---------------------------------------------------------------

const clickNav = (destinationId) => ({
  trigger: { type: 'ON_CLICK' },
  action: {
    type: 'NODE', destinationId, navigation: 'NAVIGATE',
    transition: { type: 'SMART_ANIMATE', duration: 300, easing: { type: 'EASE_IN_AND_OUT' } },
  },
});

const timeoutBack = { trigger: { type: 'AFTER_TIMEOUT', timeout: 1200 }, action: { type: 'BACK' } };

function floatTrack(positions) {
  return {
    baseValue: { type: 'FLOAT', value: 0 },
    keyframes: positions.map((position) => ({ timelinePosition: position, value: { type: 'FLOAT', value: position } })),
  };
}

const TRANSLATION_X = { type: 'PROPERTY', name: 'TRANSLATION_X' };

function makeShader(index) {
  return {
    id: `shader-${index}`, name: `Shader ${index}`, type: 'GLSL', imported: index % 2 === 0,
    ...(index % 3 === 0 ? { propertyDefinitions: [{ name: 'speed', type: 'FLOAT' }] } : {}),
  };
}

// ---- figma_set_reactions ----------------------------------------------------

test('setReactions writes via setReactionsAsync with whitelist passthrough and reads back', async () => {
  const plugin = await makePlugin();
  const target = plugin.seed('FRAME');
  const destination = plugin.seed('FRAME');
  const calls = [];
  target.setReactionsAsync = async (reactions) => {
    assert.ok(Array.isArray(reactions));
    calls.push(plain(reactions));
    target.reactions = reactions;
  };
  const data = success(await plugin.send('setReactions', {
    id: target.id, action: 'set', reactions: [clickNav(destination.id), timeoutBack],
  }));
  assert.equal(data.state, 'succeeded');
  assert.ok(data.affectedNodeIds.includes(target.id), JSON.stringify(data));
  assert.equal(calls.length, 1);
  // setReactionsAsync receives the modern plural `actions` form.
  assert.deepEqual(calls[0], [
    { trigger: clickNav(destination.id).trigger, actions: [clickNav(destination.id).action] },
    { trigger: timeoutBack.trigger, actions: [timeoutBack.action] },
  ]);
  assert.deepEqual(data.reactions, calls[0]);
  assert.equal(data.reactionsCount, 2);
  assert.equal(data.prototypeStartNodeId, null);
  assert.ok(plugin.mutations.some((m) => m.nodeId === target.id && m.prop === 'reactions'));
});

test('setReactions falls back to the reactions property when the async API is absent', async () => {
  const plugin = await makePlugin();
  const target = plugin.seed('FRAME');
  const destination = plugin.seed('FRAME');
  const data = success(await plugin.send('setReactions', {
    id: target.id, action: 'set', reactions: [clickNav(destination.id)],
  }));
  assert.deepEqual(data.reactions, [clickNav(destination.id)]);
  assert.deepEqual(plain(target.reactions), [clickNav(destination.id)]);
  assert.ok(plugin.mutations.some((m) => m.nodeId === target.id && m.prop === 'reactions'));
});

test('clear empties reactions through both write paths', async () => {
  const plugin = await makePlugin();
  const asyncNode = plugin.seed('FRAME');
  asyncNode.reactions = [clickNav(asyncNode.id)];
  const calls = [];
  asyncNode.setReactionsAsync = async (reactions) => { calls.push(plain(reactions)); asyncNode.reactions = reactions; };
  const data = success(await plugin.send('setReactions', { id: asyncNode.id, action: 'clear' }));
  assert.deepEqual(calls, [[]]);
  assert.deepEqual(data.reactions, []);
  assert.equal(data.reactionsCount, 0);
  const fallbackNode = plugin.seed('FRAME');
  fallbackNode.reactions = [timeoutBack];
  success(await plugin.send('setReactions', { id: fallbackNode.id, action: 'clear' }));
  assert.deepEqual(plain(fallbackNode.reactions), []);
});

test('setReactions rejects illegal triggers, actions, unknown fields and oversized lists', async () => {
  const plugin = await makePlugin();
  const target = plugin.seed('FRAME');
  const invalid = [
    { reactions: [{ trigger: { type: 'ON_TAP' }, action: { type: 'BACK' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'TELEPORT' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK', foo: 1 }, action: { type: 'BACK' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'BACK', foo: 1 } }] },
    { reactions: [{ trigger: { type: 'AFTER_TIMEOUT' }, action: { type: 'BACK' } }] },
    { reactions: [{ trigger: { type: 'AFTER_TIMEOUT', timeout: 0 }, action: { type: 'BACK' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'URL' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'URL', url: 'javascript:alert(1)' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'OPEN_LINK', url: 'ftp://example.com' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NAVIGATE', navigation: 'NAVIGATE' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NAVIGATE', navigation: 'SWAP' } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NAVIGATE', destinationId: '9:9', transition: { type: 'SMART_ANIMATE', duration: 300, easing: { type: 'BOUNCE' } } } }] },
    { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NAVIGATE', destinationId: '9:9', transition: { type: 'SMART_ANIMATE', duration: 20000, easing: { type: 'LINEAR' } } } }] },
    { reactions: Array.from({ length: 65 }, () => ({ trigger: { type: 'ON_CLICK' }, action: { type: 'BACK' } })) },
  ];
  for (const extra of invalid) {
    const error = failure(await plugin.send('setReactions', { id: target.id, action: 'set', ...extra }));
    assert.equal(error.code, 'INVALID_PARAM', JSON.stringify(error));
  }
  const missing = failure(await plugin.send('setReactions', { id: target.id, action: 'set' }));
  assert.equal(missing.code, 'INVALID_PARAM');
  assert.equal(plugin.mutations.length, 0, 'rejected writes must not touch the canvas');
  assert.deepEqual(plain(target.reactions), []);
});

test('setReactions rejects navigation targets that do not exist', async () => {
  const plugin = await makePlugin();
  const target = plugin.seed('FRAME');
  const error = failure(await plugin.send('setReactions', {
    id: target.id, action: 'set', reactions: [clickNav('9:9')],
  }));
  assert.equal(error.code, 'INVALID_TARGET', JSON.stringify(error));
  assert.equal(plugin.mutations.length, 0);
  assert.deepEqual(plain(target.reactions), []);
});

test('prototypeStartNodeId sets and clears the page start node and validates existence', async () => {
  const plugin = await makePlugin();
  const target = plugin.seed('FRAME');
  const start = plugin.seed('FRAME');
  const sets = [];
  Object.defineProperty(plugin.pageA, 'prototypeStartNode', {
    configurable: true,
    get: () => (sets.length ? sets[sets.length - 1] : null),
    set: (value) => { sets.push(value); },
  });
  const set = success(await plugin.send('setReactions', {
    id: target.id, action: 'clear', prototypeStartNodeId: start.id,
  }));
  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, start.id);
  assert.equal(set.prototypeStartNodeId, start.id);
  const cleared = success(await plugin.send('setReactions', {
    id: target.id, action: 'clear', prototypeStartNodeId: null,
  }));
  assert.equal(sets.length, 2);
  assert.equal(sets[1], null);
  assert.equal(cleared.prototypeStartNodeId, null);
  const before = sets.length;
  success(await plugin.send('setReactions', { id: target.id, action: 'clear' }));
  assert.equal(sets.length, before, 'omitting prototypeStartNodeId must leave the start node untouched');
  const mutationMarker = plugin.mutations.length;
  const missing = failure(await plugin.send('setReactions', {
    id: target.id, action: 'clear', prototypeStartNodeId: '9:9',
  }));
  assert.equal(missing.code, 'NODE_NOT_FOUND');
  assert.equal(plugin.mutations.length, mutationMarker, 'failed start-node writes must not record mutations');
});

// ---- figma_motion -----------------------------------------------------------

test('motion listAnimationStyles reports UNSUPPORTED without the API and lists styles when present', async () => {
  const plugin = await makePlugin();
  const error = failure(await plugin.send('motion', { action: 'listAnimationStyles' }));
  assert.equal(error.code, 'UNSUPPORTED', JSON.stringify(error));
  plugin.figma.motion = {
    figmaAnimationStyles: async () => [
      { id: 'S1', name: 'Fade in' }, { id: 'S2' },
      ...Array.from({ length: 205 }, (_, i) => ({ id: `bulk-${i}`, name: `bulk ${i}` })),
    ],
  };
  const data = success(await plugin.send('motion', { action: 'listAnimationStyles' }));
  assert.equal(data.total, 207);
  assert.equal(data.styles.length, 200);
  assert.deepEqual(data.styles[0], { id: 'S1', name: 'Fade in' });
  assert.deepEqual(data.styles[1], { id: 'S2' });
  assert.equal(data.styles.at(-1).id, 'bulk-197');
});

test('motion readNode returns present properties and marks missing ones unsupported', async () => {
  const plugin = await makePlugin();
  const bare = plugin.seed('FRAME');
  const bareData = success(await plugin.send('motion', { action: 'readNode', id: bare.id }));
  assert.deepEqual(bareData.animations, null);
  assert.deepEqual(bareData.manualKeyframeTracks, null);
  assert.deepEqual(bareData.timelines, null);
  assert.deepEqual(bareData.animationStyles, null);
  assert.deepEqual(bareData.unsupportedFields, ['animations', 'manualKeyframeTracks', 'timelines', 'animationStyles']);
  const rich = plugin.seed('FRAME');
  rich.animations = [{ duration: 0.3 }];
  rich.manualKeyframeTracks = [];
  const richData = success(await plugin.send('motion', { action: 'readNode', id: rich.id }));
  assert.deepEqual(richData.animations, [{ duration: 0.3 }]);
  assert.deepEqual(richData.manualKeyframeTracks, []);
  assert.deepEqual(richData.timelines, null);
  assert.ok(richData.unsupportedFields.includes('timelines'));
  assert.ok(!richData.unsupportedFields.includes('animations'));
  assert.equal(plugin.mutations.length, 0, 'readNode must stay read-only');
});

test('motion applyStyle/removeStyle need native methods and read back animationStyles', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('FRAME');
  const applyError = failure(await plugin.send('motion', { action: 'applyStyle', id: node.id, styleId: 'S1' }));
  assert.equal(applyError.code, 'UNSUPPORTED');
  const removeError = failure(await plugin.send('motion', { action: 'removeStyle', id: node.id, styleId: 'S1' }));
  assert.equal(removeError.code, 'UNSUPPORTED');
  const applied = [];
  const removed = [];
  node.applyAnimationStyle = async (styleId) => { applied.push(styleId); node.animationStyles = [{ id: styleId }]; };
  node.removeAnimationStyle = async (styleId) => { removed.push(styleId); node.animationStyles = []; };
  const appliedData = success(await plugin.send('motion', { action: 'applyStyle', id: node.id, styleId: 'S1' }));
  assert.deepEqual(applied, ['S1']);
  assert.deepEqual(appliedData.animationStyles, [{ id: 'S1' }]);
  assert.ok(appliedData.affectedNodeIds.includes(node.id));
  const removedData = success(await plugin.send('motion', { action: 'removeStyle', id: node.id, styleId: 'S1' }));
  assert.deepEqual(removed, ['S1']);
  assert.deepEqual(removedData.animationStyles, []);
});

test('motion applyTrack validates field and track and applies native keyframe tracks', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('FRAME');
  const unsupported = failure(await plugin.send('motion', {
    action: 'applyTrack', id: node.id, field: TRANSLATION_X, track: floatTrack([0, 300]),
  }));
  assert.equal(unsupported.code, 'UNSUPPORTED');
  const calls = [];
  node.applyManualKeyframeTrack = async (field, track) => {
    calls.push([plain(field), plain(track)]);
    node.manualKeyframeTracks = [{ field: plain(field), keyframeCount: plain(track).keyframes.length }];
  };
  const data = success(await plugin.send('motion', {
    action: 'applyTrack', id: node.id, field: TRANSLATION_X, track: floatTrack([0, 300, 600]),
  }));
  assert.deepEqual(calls[0][0], { type: 'PROPERTY', name: 'TRANSLATION_X' });
  assert.deepEqual(calls[0][1], floatTrack([0, 300, 600]));
  assert.deepEqual(data.manualKeyframeTracks, [{ field: TRANSLATION_X, keyframeCount: 3 }]);
  assert.ok(data.affectedNodeIds.includes(node.id));
  const paintTrack = success(await plugin.send('motion', {
    action: 'applyTrack', id: node.id, field: { type: 'PAINT', name: 'fills', index: 0 }, track: floatTrack([0, 1]),
  }));
  assert.ok(paintTrack.manualKeyframeTracks);
  const rejected = [
    { field: TRANSLATION_X, track: floatTrack([0, 0]) },
    { field: TRANSLATION_X, track: floatTrack([300, 100]) },
    { field: TRANSLATION_X, track: floatTrack([]) },
    { field: TRANSLATION_X, track: { baseValue: { type: 'FLOAT', value: 0 }, keyframes: Array.from({ length: 513 }, (_, i) => ({ timelinePosition: i, value: { type: 'FLOAT', value: i } })) } },
    { field: { type: 'PAINT', name: 'fills' }, track: floatTrack([0, 1]) },
    { field: { type: 'PAINT', name: 'fills', index: 65 }, track: floatTrack([0, 1]) },
    { field: { type: 'WRONG', name: 'x' }, track: floatTrack([0, 1]) },
    { field: { type: 'PROPERTY' }, track: floatTrack([0, 1]) },
  ];
  for (const extra of rejected) {
    const error = failure(await plugin.send('motion', { action: 'applyTrack', id: node.id, ...extra }));
    assert.equal(error.code, 'INVALID_PARAM', JSON.stringify(error));
  }
});

test('motion removeTrack and setDuration need native methods and succeed when present', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('FRAME');
  const removeError = failure(await plugin.send('motion', { action: 'removeTrack', id: node.id, field: TRANSLATION_X }));
  assert.equal(removeError.code, 'UNSUPPORTED');
  const durationError = failure(await plugin.send('motion', { action: 'setDuration', id: node.id, duration: 1500 }));
  assert.equal(durationError.code, 'UNSUPPORTED');
  const removed = [];
  const durations = [];
  node.removeManualKeyframeTrack = async (field) => { removed.push(plain(field)); node.manualKeyframeTracks = []; };
  node.setTimelineDuration = async (duration) => { durations.push(duration); };
  const removedData = success(await plugin.send('motion', { action: 'removeTrack', id: node.id, field: TRANSLATION_X }));
  assert.deepEqual(removed, [TRANSLATION_X]);
  assert.deepEqual(removedData.manualKeyframeTracks, []);
  const durationData = success(await plugin.send('motion', { action: 'setDuration', id: node.id, duration: 1500 }));
  assert.deepEqual(durations, [1500]);
  assert.equal(durationData.duration, 1500);
  assert.ok(durationData.affectedNodeIds.includes(node.id));
  for (const duration of [0, -5]) {
    const error = failure(await plugin.send('motion', { action: 'setDuration', id: node.id, duration }));
    assert.equal(error.code, 'INVALID_PARAM', JSON.stringify(error));
  }
});

// ---- figma_shaders ----------------------------------------------------------

test('shaders paginate read-only, omit unreadable property definitions and never touch the canvas', async () => {
  const shaders = Array.from({ length: 250 }, (_, i) => makeShader(i));
  shaders.push({
    id: 'shader-blocked', name: 'Blocked', type: 'GLSL', imported: false,
    get propertyDefinitions() { throw new Error('shader is not imported'); },
  });
  const plugin = await makePlugin({ shaders });
  const page1 = success(await plugin.send('shaders', {}));
  assert.equal(page1.total, 251);
  assert.equal(page1.shaders.length, 100);
  assert.equal(page1.nextCursor, '100');
  assert.deepEqual(page1.shaders[0], { id: 'shader-0', name: 'Shader 0', type: 'GLSL', imported: true, propertyDefinitions: [{ name: 'speed', type: 'FLOAT' }] });
  assert.deepEqual(page1.shaders[1], { id: 'shader-1', name: 'Shader 1', type: 'GLSL', imported: false });
  const page2 = success(await plugin.send('shaders', { cursor: page1.nextCursor }));
  assert.equal(page2.shaders.length, 100);
  assert.equal(page2.shaders[0].id, 'shader-100');
  assert.equal(page2.nextCursor, '200');
  const page3 = success(await plugin.send('shaders', { cursor: page2.nextCursor }));
  assert.equal(page3.shaders.length, 51);
  assert.equal(page3.nextCursor, null);
  const blocked = page3.shaders.find((shader) => shader.id === 'shader-blocked');
  assert.equal(blocked.name, 'Blocked');
  assert.equal(blocked.propertyDefinitions, undefined);
  assert.equal(blocked.propertyDefinitionsReadable, false);
  const end = success(await plugin.send('shaders', { cursor: '251' }));
  assert.deepEqual(end.shaders, []);
  assert.equal(end.nextCursor, null);
  assert.equal(failure(await plugin.send('shaders', { cursor: 'abc' })).code, 'INVALID_PARAM');
  assert.equal(failure(await plugin.send('shaders', { cursor: '007' })).code, 'INVALID_PARAM');
  assert.equal(plugin.mutations.length, 0, 'shader listing must never modify the canvas');
  assert.equal(plugin.pageA.children.length, 0);
});
