// Motion domain: Motion animation styles, manual keyframe tracks, timeline
// duration, and read-only shader discovery. Shader listing never imports or
// applies anything; unreadable data is reported as unavailable, not invented.
import { appErr, requireStr, isPlainObject, cloneValue, onlyKeys } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'motion',
  actions: ['listAnimationStyles', 'readNode', 'applyStyle', 'removeStyle', 'applyTrack', 'removeTrack', 'setDuration', 'shaders'],
  preconditions: ['Motion/MP4 需对应运行时 API 与带动画顶层 Frame 样本'],
  notes: ['未导入的 Shader 属性可能不可读，返回不可得原因，不隐式导入', 'shaders 分页为偏移式，不固定成员列表'],
};

const FIELD_TYPES = new Set(['PROPERTY', 'PAINT', 'EFFECT']);
const MOTION_PROPS = ['animations', 'manualKeyframeTracks', 'timelines', 'animationStyles'];
const STYLE_LIMIT = 200;
const SHADER_PAGE_SIZE = 100;
const MAX_KEYFRAMES = 512;

function jsonSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function requireId(p) {
  return requireStr(p.id, 'id');
}

function readProp(node, key) {
  if (!(key in node)) return null;
  try {
    const value = cloneValue(node[key]);
    return value === undefined ? null : value;
  } catch { return null; }
}

function motionApi() {
  if (!figma.motion || typeof figma.motion.figmaAnimationStyles !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持 Motion API');
  }
  return figma.motion.figmaAnimationStyles.bind(figma.motion);
}

async function listAnimationStyles(t) {
  const api = motionApi();
  const raw = await api();
  assertTarget(t);
  const list = Array.isArray(raw) ? raw : [];
  const styles = [];
  for (const item of list.slice(0, STYLE_LIMIT)) {
    const safe = jsonSafe(item);
    if (safe && isPlainObject(safe)) {
      styles.push({ id: safe.id !== undefined ? safe.id : null, ...safe });
    }
  }
  return { styles, total: list.length };
}

async function readMotionNode(p, t) {
  const node = await getNode(requireId(p), t);
  assertTarget(t);
  const out = { id: node.id };
  const unsupported = [];
  for (const key of MOTION_PROPS) {
    if (!(key in node)) { out[key] = null; unsupported.push(key); continue; }
    try {
      const value = cloneValue(node[key]);
      if (value === undefined) throw new Error('unreadable');
      out[key] = value;
    } catch {
      out[key] = null;
      unsupported.push(key);
    }
  }
  if (unsupported.length) out.unsupportedFields = unsupported;
  return out;
}

async function applyStyle(p, t) {
  const styleId = requireStr(p.styleId, 'styleId');
  const node = await getNode(requireId(p), t);
  assertTarget(t);
  if (typeof node.applyAnimationStyle !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持应用 Motion 动画样式');
  }
  await node.applyAnimationStyle(styleId);
  assertTarget(t);
  markMutation(t, node);
  return { id: node.id, styleId, animationStyles: readProp(node, 'animationStyles') };
}

async function removeStyle(p, t) {
  const styleId = requireStr(p.styleId, 'styleId');
  const node = await getNode(requireId(p), t);
  assertTarget(t);
  if (typeof node.removeAnimationStyle !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持移除 Motion 动画样式');
  }
  await node.removeAnimationStyle(styleId);
  assertTarget(t);
  markMutation(t, node);
  return { id: node.id, styleId, animationStyles: readProp(node, 'animationStyles') };
}

// field: {type:'PROPERTY'|'PAINT'|'EFFECT', name required, index required
// 0..64 for PAINT/EFFECT}. track: {baseValue object, keyframes 1..512 with
// strictly increasing timelinePosition >= 0 and object values}.
function validateField(raw) {
  if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', 'field 必须是对象');
  if (!FIELD_TYPES.has(raw.type)) throw appErr('INVALID_PARAM', `field.type 非法: ${raw.type}`);
  if (typeof raw.name !== 'string' || !raw.name.length) throw appErr('INVALID_PARAM', 'field.name 必填');
  if (raw.type === 'PAINT' || raw.type === 'EFFECT') {
    if (!Number.isSafeInteger(raw.index) || raw.index < 0 || raw.index > 64) {
      throw appErr('INVALID_PARAM', `field.type 为 ${raw.type} 时 field.index 必须是 0–64 的整数`);
    }
  }
  return raw;
}

function validateTrack(raw) {
  if (!isPlainObject(raw)) throw appErr('INVALID_PARAM', 'track 必须是对象');
  if (!isPlainObject(raw.baseValue)) throw appErr('INVALID_PARAM', 'track.baseValue 必须是对象');
  if (!Array.isArray(raw.keyframes) || raw.keyframes.length < 1 || raw.keyframes.length > MAX_KEYFRAMES) {
    throw appErr('INVALID_PARAM', `track.keyframes 需要 1–${MAX_KEYFRAMES} 项`);
  }
  let previous = -Infinity;
  raw.keyframes.forEach((frame, i) => {
    const label = `track.keyframes[${i}]`;
    if (!isPlainObject(frame)) throw appErr('INVALID_PARAM', `${label} 必须是对象`);
    if (typeof frame.timelinePosition !== 'number' || !Number.isFinite(frame.timelinePosition) || frame.timelinePosition < 0) {
      throw appErr('INVALID_PARAM', `${label}.timelinePosition 必须是 >=0 的数字`);
    }
    if (frame.timelinePosition <= previous) {
      throw appErr('INVALID_PARAM', `${label}.timelinePosition 必须严格递增`);
    }
    previous = frame.timelinePosition;
    if (!isPlainObject(frame.value)) throw appErr('INVALID_PARAM', `${label}.value 必须是对象`);
  });
  return raw;
}

async function applyTrack(p, t) {
  const field = validateField(p.field);
  const track = validateTrack(p.track);
  const node = await getNode(requireId(p), t);
  assertTarget(t);
  if (typeof node.applyManualKeyframeTrack !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持手动关键帧轨道');
  }
  await node.applyManualKeyframeTrack(field, track);
  assertTarget(t);
  markMutation(t, node);
  return { id: node.id, manualKeyframeTracks: readProp(node, 'manualKeyframeTracks') };
}

async function removeTrack(p, t) {
  const field = validateField(p.field);
  const node = await getNode(requireId(p), t);
  assertTarget(t);
  if (typeof node.removeManualKeyframeTrack !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持移除手动关键帧轨道');
  }
  await node.removeManualKeyframeTrack(field);
  assertTarget(t);
  markMutation(t, node);
  return { id: node.id, manualKeyframeTracks: readProp(node, 'manualKeyframeTracks') };
}

async function setDuration(p, t) {
  requireId(p);
  if (typeof p.duration !== 'number' || !Number.isFinite(p.duration) || p.duration <= 0) {
    throw appErr('INVALID_PARAM', 'duration 必须是 >0 的数字');
  }
  const node = await getNode(p.id, t);
  assertTarget(t);
  if (typeof node.setTimelineDuration !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持设置时间线时长');
  }
  await node.setTimelineDuration(p.duration);
  assertTarget(t);
  markMutation(t, node);
  return { id: node.id, duration: p.duration };
}

async function handleMotion(p, t) {
  onlyKeys(p, ['action', 'id', 'styleId', 'duration', 'field', 'track']);
  switch (p.action) {
    case 'listAnimationStyles': return listAnimationStyles(t);
    case 'readNode': return readMotionNode(p, t);
    case 'applyStyle': return applyStyle(p, t);
    case 'removeStyle': return removeStyle(p, t);
    case 'applyTrack': return applyTrack(p, t);
    case 'removeTrack': return removeTrack(p, t);
    case 'setDuration': return setDuration(p, t);
    default: throw appErr('INVALID_PARAM', `未知 action: ${p.action}`);
  }
}

// Read-only shader discovery with cursor pagination (<=100 per page). Never
// imports shaders or touches nodes; propertyDefinitions are included only when
// they exist and serialize cleanly.
function serializeShader(shader) {
  const objectLike = shader !== null && typeof shader === 'object' && !Array.isArray(shader);
  if (!objectLike) return { id: null, name: null, type: null, imported: false };
  const out = {
    id: shader.id !== undefined ? shader.id : null,
    name: shader.name !== undefined ? shader.name : null,
    type: shader.type !== undefined ? shader.type : null,
    imported: shader.imported === true,
  };
  if ('propertyDefinitions' in shader) {
    let safe = null;
    try { safe = jsonSafe(shader.propertyDefinitions); } catch { safe = null; }
    if (safe !== null) out.propertyDefinitions = safe;
    else out.propertyDefinitionsReadable = false;
  }
  return out;
}

async function handleShaders(p, t) {
  onlyKeys(p, ['cursor']);
  if (typeof figma.listAvailableShaders !== 'function') {
    throw appErr('UNSUPPORTED', '当前环境不支持 Shader API');
  }
  const raw = await figma.listAvailableShaders();
  assertTarget(t);
  const list = Array.isArray(raw) ? raw : [];
  const offset = p.cursor === undefined ? 0 : Number(p.cursor);
  if (offset > list.length) throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  const page = list.slice(offset, offset + SHADER_PAGE_SIZE).map(serializeShader);
  const next = offset + page.length;
  return {
    shaders: page,
    total: list.length,
    nextCursor: next < list.length ? String(next) : null,
  };
}

export const handlers = {
  motion: handleMotion,
  shaders: handleShaders,
};
