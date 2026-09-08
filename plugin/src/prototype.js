// Prototype domain: node reactions and the page prototype start node. Writes
// use setReactionsAsync when the runtime provides it and fall back to the
// reactions property; reaction structures pass through under a strict field
// whitelist without over-normalizing.
import { appErr, isPlainObject, cloneValue, onlyKeys } from './util.js';
import { getNode, assertTarget, markMutation } from './context.js';

export const domainMeta = {
  name: 'prototype',
  actions: ['set', 'clear'],
  notes: ['关键导航与返回须实际点击验收（真机）'],
};

const TRIGGER_TYPES = new Set(['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG',
  'AFTER_TIMEOUT', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN']);
// Mirrors the official Action union (BACK/CLOSE/URL/UPDATE_MEDIA_RUNTIME/
// SET_VARIABLE/SET_VARIABLE_MODE/CONDITIONAL/NODE); legacy 'LINK'/'NAVIGATE'
// action types do not exist in the API.
const ACTION_TYPES = new Set(['BACK', 'CLOSE', 'URL', 'OPEN_LINK', 'UPDATE_MEDIA_RUNTIME',
  'SET_VARIABLE', 'SET_VARIABLE_MODE', 'CONDITIONAL', 'NODE']);
const ACTION_KEYS = ['destinationId', 'navigation', 'transition', 'url',
  'preserveScrollPosition', 'overlayRelativePosition'];
const MAX_REACTIONS = 64;

// Semantic rules beyond the shared JSON schema (shape/enum/bounds are already
// enforced there): AFTER_TIMEOUT needs timeout>=1, URL/OPEN_LINK need an
// http(s) url, and navigate/swap actions need a destinationId.
function normalizeReaction(raw, index) {
  const label = `reactions[${index}]`;
  if (!isPlainObject(raw) || !isPlainObject(raw.trigger) || !isPlainObject(raw.action)) {
    throw appErr('INVALID_PARAM', `${label} 必须是 {trigger, action} 结构`);
  }
  const triggerType = raw.trigger.type;
  if (!TRIGGER_TYPES.has(triggerType)) throw appErr('INVALID_PARAM', `${label}.trigger.type 非法: ${triggerType}`);
  if (triggerType === 'AFTER_TIMEOUT') {
    const timeout = raw.trigger.timeout;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 1) {
      throw appErr('INVALID_PARAM', `${label}: AFTER_TIMEOUT 触发器需要 >=1 的 timeout`);
    }
  }
  const actionType = raw.action.type;
  if (!ACTION_TYPES.has(actionType)) throw appErr('INVALID_PARAM', `${label}.action.type 非法: ${actionType}`);
  if (actionType === 'URL' || actionType === 'OPEN_LINK') {
    if (typeof raw.action.url !== 'string' || !/^https?:\/\//i.test(raw.action.url)) {
      throw appErr('INVALID_PARAM', `${label}.action.url 必须是 http/https 地址`);
    }
  }
  const navigation = raw.action.navigation;
  if ((actionType === 'NAVIGATE' || navigation === 'SWAP')
    && (typeof raw.action.destinationId !== 'string' || !raw.action.destinationId.length)) {
    throw appErr('INVALID_PARAM', `${label}: ${actionType === 'NAVIGATE' ? 'NAVIGATE' : 'SWAP'} 动作必须有 destinationId`);
  }
  const trigger = { type: triggerType };
  if (raw.trigger.timeout !== undefined) trigger.timeout = raw.trigger.timeout;
  const action = { type: actionType };
  for (const key of ACTION_KEYS) {
    if (raw.action[key] !== undefined) action[key] = raw.action[key];
  }
  return { trigger, action };
}

async function assertDestination(id, t, label) {
  try { await getNode(id, t); }
  catch (e) {
    if (e && e.code === 'NODE_NOT_FOUND') {
      throw appErr('INVALID_TARGET', `${label} 导航目标不存在: ${id}`);
    }
    throw e;
  }
}

async function handleSetReactions(p, t) {
  onlyKeys(p, ['action', 'id', 'reactions', 'prototypeStartNodeId']);
  if (p.action !== 'set' && p.action !== 'clear') throw appErr('INVALID_PARAM', 'action 必须是 set 或 clear');
  const node = await getNode(p.id, t);
  let reactions = [];
  if (p.action === 'set') {
    if (!Array.isArray(p.reactions)) throw appErr('INVALID_PARAM', 'set 需要 reactions 数组');
    if (p.reactions.length > MAX_REACTIONS) throw appErr('INVALID_PARAM', `reactions 数量超过 ${MAX_REACTIONS}`);
    reactions = p.reactions.map(normalizeReaction);
    for (let i = 0; i < reactions.length; i++) {
      const destinationId = reactions[i].action.destinationId;
      if (destinationId) await assertDestination(destinationId, t, `reactions[${i}]`);
    }
  }
  let startNode = null;
  const touchesStartNode = p.prototypeStartNodeId !== undefined;
  if (touchesStartNode && p.prototypeStartNodeId !== null) {
    startNode = await getNode(p.prototypeStartNodeId, t);
  }
  assertTarget(t);
  markMutation(t, node);
  if (touchesStartNode && startNode) markMutation(t, startNode);
  try {
    if (typeof node.setReactionsAsync === 'function') {
      // The modern API requires the plural `actions` array per reaction
      // (writing the legacy singular `action` is rejected to prevent loss).
      const apiReactions = reactions.map(reaction => ({ trigger: reaction.trigger, actions: [reaction.action] }));
      await node.setReactionsAsync(apiReactions);
    } else node.reactions = reactions;
    if (touchesStartNode) figma.currentPage.prototypeStartNode = startNode;
  } catch (e) {
    if (e && e.code) throw e;
    throw appErr('REACTION_WRITE_FAILED', '写入 reactions 失败: ' + (e && e.message ? e.message : String(e)));
  }
  assertTarget(t);
  const pageStart = figma.currentPage.prototypeStartNode;
  return {
    id: node.id,
    reactions: cloneValue(node.reactions),
    reactionsCount: Array.isArray(node.reactions) ? node.reactions.length : 0,
    prototypeStartNodeId: pageStart && pageStart.id ? pageStart.id : null,
  };
}

export const handlers = {
  setReactions: handleSetReactions,
};
