import assert from 'node:assert/strict';
import { makePlugin, success, failure, plain, test, inter } from './helpers/figma-vm.js';

// ---- fixtures ---------------------------------------------------------------

const STYLE_KEYS = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills', 'textCase', 'textDecoration'];

// Patches a realistic range-style API onto a fixture TEXT node: setRange*
// writes update a range-state store, getRange* read it back, and whole-range
// writes are mirrored into the node's native properties. failOn makes one
// method throw mid-sequence.
function patchRangeApi(node, calls = [], { failOn } = {}) {
  const state = {
    fontName: { ...inter },
    fontSize: node.fontSize,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [],
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
  };
  const whole = (start, end) => start === 0 && end === node.characters.length;
  node.setRangeFontName = (start, end, value) => {
    calls.push({ method: 'setRangeFontName', start, end, value: plain(value) });
    if (failOn === 'setRangeFontName') throw new Error('injected fontName failure');
    state.fontName = plain(value);
    if (whole(start, end)) node.fontName = value;
  };
  node.setRangeFontSize = (start, end, value) => {
    calls.push({ method: 'setRangeFontSize', start, end, value });
    if (failOn === 'setRangeFontSize') throw new Error('injected fontSize failure');
    state.fontSize = value;
    if (whole(start, end)) node.fontSize = value;
  };
  node.setRangeLineHeight = (start, end, value) => {
    calls.push({ method: 'setRangeLineHeight', start, end, value: plain(value) });
    if (failOn === 'setRangeLineHeight') throw new Error('injected lineHeight failure');
    state.lineHeight = plain(value);
  };
  node.setRangeLetterSpacing = (start, end, value) => {
    calls.push({ method: 'setRangeLetterSpacing', start, end, value: plain(value) });
    if (failOn === 'setRangeLetterSpacing') throw new Error('injected letterSpacing failure');
    state.letterSpacing = plain(value);
  };
  node.setRangeFills = (start, end, value) => {
    calls.push({ method: 'setRangeFills', start, end, value: plain(value) });
    if (failOn === 'setRangeFills') throw new Error('injected fills failure');
    state.fills = plain(value);
    if (whole(start, end)) node.fills = value;
  };
  node.setRangeTextCase = (start, end, value) => {
    calls.push({ method: 'setRangeTextCase', start, end, value });
    if (failOn === 'setRangeTextCase') throw new Error('injected textCase failure');
    state.textCase = value;
  };
  node.setRangeTextDecoration = (start, end, value) => {
    calls.push({ method: 'setRangeTextDecoration', start, end, value });
    if (failOn === 'setRangeTextDecoration') throw new Error('injected textDecoration failure');
    state.textDecoration = value;
  };
  node.getRangeFontName = () => plain(state.fontName);
  node.getRangeFontSize = () => state.fontSize;
  node.getRangeLineHeight = () => plain(state.lineHeight);
  node.getRangeLetterSpacing = () => plain(state.letterSpacing);
  node.getRangeTextCase = () => state.textCase;
  node.getRangeTextDecoration = () => state.textDecoration;
  node.getRangeFills = () => plain(state.fills);
  return state;
}

// ---- figma_text_range: getStyles ---------------------------------------------

test('getStyles reads range styles, segments and context without mutating', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'Hello 世界' });
  patchRangeApi(node);
  const data = success(await plugin.send('textRange', { id: node.id, action: 'getStyles' }));
  assert.equal(data.actualStart, 0);
  assert.equal(data.actualEnd, 8);
  assert.equal(data.charactersLength, 8);
  assert.deepEqual(data.styles.fontName, { family: 'Inter', style: 'Regular' });
  assert.equal(data.styles.fontSize, 12);
  assert.deepEqual(data.styles.lineHeight, { unit: 'AUTO' });
  assert.deepEqual(data.styles.letterSpacing, { unit: 'PIXELS', value: 0 });
  assert.equal(data.styles.textCase, 'ORIGINAL');
  assert.equal(data.styles.textDecoration, 'NONE');
  assert.deepEqual(data.styles.fills, []);
  assert.equal(data.segmentsTotal, 1);
  assert.equal(data.segments.length, 1);
  assert.equal(data.segments[0].characters, 'Hello 世界');
  assert.deepEqual(data.segments[0].fontName, { family: 'Inter', style: 'Regular' });
  assert.equal(data.segments[0].fontSize, 12);
  assert.deepEqual(data.segments[0].fills, []);
  assert.equal(data.sessionId, plugin.context.sessionId);
  assert.equal(data.pageId, plugin.context.pageId);
  assert.equal(data.pageRevision, plugin.context.pageRevision);
  assert.equal(plugin.mutations.length, 0, 'getStyles must stay read-only');
});

test('getStyles honors explicit ranges, reports mixed values and passes corrected bounds to getters', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const seen = [];
  node.getRangeFontSize = (start, end) => { seen.push([start, end]); return 12; };
  node.getRangeFontName = () => plugin.figma.mixed;
  node.getRangeLineHeight = () => ({ unit: 'PIXELS', value: 20 });
  node.getRangeLetterSpacing = () => ({ unit: 'PERCENT', value: 2 });
  node.getRangeTextCase = () => 'LOWER';
  node.getRangeTextDecoration = () => 'UNDERLINE';
  node.getRangeFills = () => [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
  const data = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 2, end: 5 }));
  assert.equal(data.charactersLength, 6);
  assert.deepEqual([data.actualStart, data.actualEnd], [2, 5]);
  assert.deepEqual(seen, [[2, 5]]);
  assert.deepEqual(data.styles.fontName, { mixed: true });
  assert.equal(data.styles.fontSize, 12);
  assert.deepEqual(data.styles.fills, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
  assert.equal(data.styles.textDecoration, 'UNDERLINE');
  // default range covers the whole text
  const full = success(await plugin.send('textRange', { id: node.id, action: 'getStyles' }));
  assert.deepEqual([full.actualStart, full.actualEnd], [0, 6]);
  assert.deepEqual(seen.at(-1), [0, 6]);
});

test('getStyles corrects surrogate-pair boundaries and never reports a split index', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'A🧪B' });
  assert.equal(node.characters.length, 4, '🧪 occupies two UTF-16 units');
  const seen = [];
  node.getRangeFontSize = (start, end) => { seen.push([start, end]); return 12; };
  const data = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 2, end: 3 }));
  assert.equal(data.actualStart, 1, 'start=2 splits the pair and must fall back to 1');
  assert.equal(data.actualEnd, 3);
  assert.deepEqual(seen[0], [1, 3]);
  assert.equal(data.segments[0].characters, '🧪', 'the segment carries the whole code point');
  const endSplit = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 0, end: 2 }));
  assert.equal(endSplit.actualEnd, 1, 'end=2 splits the pair and must fall back to 1');
  const clamped = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 0, end: 99 }));
  assert.deepEqual([clamped.actualStart, clamped.actualEnd], [0, 4], 'out-of-range bounds clamp to the text');
  const inverted = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 3, end: 1 }));
  assert.deepEqual([inverted.actualStart, inverted.actualEnd], [1, 3], 'inverted reads normalize to [min, max]');
  const empty = success(await plugin.send('textRange', { id: node.id, action: 'getStyles', start: 4, end: 4 }));
  assert.deepEqual([empty.actualStart, empty.actualEnd], [4, 4]);
});

test('getStyles reports missing range getters as unsupported instead of failing', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'plain' });
  const data = success(await plugin.send('textRange', { id: node.id, action: 'getStyles' }));
  for (const key of STYLE_KEYS) {
    assert.deepEqual(data.styles[key], { status: 'unsupported' }, `styles.${key}`);
  }
  assert.equal(data.segments.length, 1, 'getStyledTextSegments still provides segments');
  assert.equal(data.segments[0].characters, 'plain');
  const failing = plugin.seed('TEXT', { text: 'plain' });
  failing.getRangeFontName = () => { throw new Error('getter exploded'); };
  const safe = success(await plugin.send('textRange', { id: failing.id, action: 'getStyles' }));
  assert.deepEqual(safe.styles.fontName, { status: 'unsupported' });
});

test('getStyles caps the segment summary at 100 entries and reports truncation', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  node.getStyledTextSegments = (fields, start = 0, end = node.characters.length) => (
    Array.from({ length: 150 }, (_, i) => ({ characters: node.characters.slice(start, end), start, end, fontSize: i }))
  );
  const data = success(await plugin.send('textRange', { id: node.id, action: 'getStyles' }));
  assert.equal(data.segmentsTotal, 150);
  assert.equal(data.segments.length, 100);
  assert.equal(data.segmentsTruncated, true);
  assert.equal(data.segments[99].fontSize, 99);
});

// ---- figma_text_range: setStyles ---------------------------------------------

test('setStyles applies styles in order, loads node fonts and reads back', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const calls = [];
  patchRangeApi(node, calls);
  const data = success(await plugin.send('textRange', {
    id: node.id, action: 'setStyles',
    styles: { fontSize: 24, textCase: 'UPPER', textDecoration: 'UNDERLINE', fills: [{ type: 'SOLID', color: '#FF0000' }] },
  }));
  assert.equal(data.state, 'succeeded');
  assert.deepEqual(data.appliedProperties, ['fontSize', 'fills', 'textCase', 'textDecoration']);
  assert.deepEqual([data.appliedStart, data.appliedEnd], [0, 6]);
  assert.equal(data.styles.fontSize, 24);
  assert.equal(data.styles.textCase, 'UPPER');
  assert.deepEqual(data.styles.fills, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
  assert.ok(data.affectedNodeIds.includes(node.id));
  assert.deepEqual(calls.map((c) => c.method), ['setRangeFontSize', 'setRangeFills', 'setRangeTextCase', 'setRangeTextDecoration']);
  assert.equal(node.fontSize, 24);
  assert.ok(plugin.mutations.some((m) => m.nodeId === node.id && m.prop === 'fontSize'));
  assert.deepEqual(plugin.fontLoads, ['Inter::Regular'], 'loadNodeFonts must load range fonts first');
});

test('setStyles loads the target font, writes fontName before fontSize and skips the node-wide load', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const calls = [];
  patchRangeApi(node, calls);
  const data = success(await plugin.send('textRange', {
    id: node.id, action: 'setStyles',
    styles: { fontSize: 18, fontName: { family: 'Roboto', style: 'Bold' } },
  }));
  assert.deepEqual(data.appliedProperties, ['fontName', 'fontSize']);
  assert.deepEqual(calls.map((c) => c.method), ['setRangeFontName', 'setRangeFontSize']);
  assert.deepEqual(data.styles.fontName, { family: 'Roboto', style: 'Bold' });
  assert.deepEqual(data.styles.fontSize, 18);
  assert.equal(node.fontSize, 18);
  assert.deepEqual(plain(node.fontName), { family: 'Roboto', style: 'Bold' });
  assert.deepEqual(plugin.fontLoads, ['Roboto::Bold'], 'only the target font is loaded');
});

test('setStyles normalizes numeric lineHeight/letterSpacing and passes unit objects through', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const calls = [];
  patchRangeApi(node, calls);
  success(await plugin.send('textRange', {
    id: node.id, action: 'setStyles',
    styles: { lineHeight: 20, letterSpacing: { unit: 'PERCENT', value: -5 }, textCase: 'LOWER', textDecoration: 'STRIKETHROUGH' },
  }));
  assert.deepEqual(calls.map((c) => [c.method, c.value]), [
    ['setRangeLineHeight', { unit: 'PIXELS', value: 20 }],
    ['setRangeLetterSpacing', { unit: 'PERCENT', value: -5 }],
    ['setRangeTextCase', 'LOWER'],
    ['setRangeTextDecoration', 'STRIKETHROUGH'],
  ]);
  const badUnit = failure(await plugin.send('textRange', {
    id: node.id, action: 'setStyles', styles: { lineHeight: { unit: 'EMU', value: 10 } },
  }));
  assert.equal(badUnit.code, 'INVALID_PARAM');
});

test('setStyles corrects surrogate-pair boundaries before writing', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'A🧪B' });
  const calls = [];
  patchRangeApi(node, calls);
  const data = success(await plugin.send('textRange', {
    id: node.id, action: 'setStyles', start: 2, end: 4, styles: { fontSize: 16 },
  }));
  assert.deepEqual([data.appliedStart, data.appliedEnd], [1, 4], 'start=2 must not split the pair');
  assert.deepEqual(calls, [{ method: 'setRangeFontSize', start: 1, end: 4, value: 16 }]);
});

test('setStyles reports FONT_NOT_LOADABLE and leaves the node untouched', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  plugin.missingFonts.add('Ghost::Regular');
  const error = failure(await plugin.send('textRange', {
    id: node.id, action: 'setStyles',
    styles: { fontName: { family: 'Ghost', style: 'Regular' }, fontSize: 20 },
  }));
  assert.equal(error.code, 'FONT_NOT_LOADABLE');
  assert.equal(error.state, 'not_started');
  assert.equal(plugin.mutations.length, 0);
  assert.deepEqual(plain(node.fontName), { family: 'Inter', style: 'Regular' });
  assert.equal(node.fontSize, 12);
  assert.ok(plugin.fontLoads.includes('Ghost::Regular'), 'the failing font must actually be attempted');
  assert.ok(!plugin.fontLoads.includes('Inter::Regular'), 'no node-wide load when a target font is given');
});

test('setStyles rejects empty/missing/unknown styles and empty corrected ranges without side effects', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const rejects = [
    { styles: {} },
    {},
    { styles: { paragraphSpacing: 4 } },
    { styles: { fontName: { family: 'Roboto' } } },
    { styles: { fontSize: 'big' } },
    { start: 3, end: 1, styles: { fontSize: 14 } },
    { start: 2, end: 2, styles: { fontSize: 14 } },
    { start: 1.5, styles: { fontSize: 14 } },
  ];
  for (const extra of rejects) {
    const error = failure(await plugin.send('textRange', { id: node.id, action: 'setStyles', ...extra }));
    assert.equal(error.code, 'INVALID_PARAM', JSON.stringify(extra));
  }
  assert.equal(plugin.mutations.length, 0, 'rejected writes must not touch the canvas');
  assert.equal(plugin.fontLoads.length, 0, 'rejected writes must not load fonts');
  assert.equal(node.fontSize, 12);
});

test('setStyles rejects non-TEXT targets and missing nodes', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  const set = failure(await plugin.send('textRange', { id: frame.id, action: 'setStyles', styles: { fontSize: 14 } }));
  assert.equal(set.code, 'INVALID_TARGET');
  const get = failure(await plugin.send('textRange', { id: frame.id, action: 'getStyles' }));
  assert.equal(get.code, 'INVALID_TARGET');
  const missing = failure(await plugin.send('textRange', { id: '9:9', action: 'getStyles' }));
  assert.equal(missing.code, 'NODE_NOT_FOUND');
  assert.equal(plugin.mutations.length, 0);
  assert.equal(plugin.fontLoads.length, 0);
});

test('setStyles fails without writing when the node lacks setRange methods', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const error = failure(await plugin.send('textRange', { id: node.id, action: 'setStyles', styles: { fontSize: 14 } }));
  assert.equal(error.code, 'UNSUPPORTED_PROPERTY');
  assert.equal(error.state, 'not_started');
  assert.equal(plugin.mutations.length, 0);
  assert.equal(node.fontSize, 12);
  assert.deepEqual(plugin.fontLoads, ['Inter::Regular'], 'font load is side-effect free and precedes the preflight');
});

test('setStyles reports partial state with appliedProperties when a write throws mid-sequence', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: 'abcdef' });
  const calls = [];
  patchRangeApi(node, calls, { failOn: 'setRangeTextCase' });
  const error = failure(await plugin.send('textRange', {
    id: node.id, action: 'setStyles',
    styles: { fontSize: 14, letterSpacing: 1, textCase: 'UPPER' },
  }));
  assert.equal(error.code, 'PROP_APPLY_FAILED');
  assert.equal(error.state, 'partial');
  assert.deepEqual(error.details.appliedProperties, ['fontSize', 'letterSpacing']);
  assert.equal(error.details.appliedStart, 0);
  assert.equal(error.details.appliedEnd, 6);
  assert.ok(error.affectedNodeIds.includes(node.id));
  assert.equal(node.fontSize, 14, 'applied properties stay applied');
  assert.deepEqual(calls.map((c) => c.method), ['setRangeFontSize', 'setRangeLetterSpacing', 'setRangeTextCase']);
  assert.ok(plugin.mutations.some((m) => m.nodeId === node.id && m.prop === 'fontSize'));
});
