// Plugin-run context and target generation checks. Session (authorization
// generation), run (plugin instance) and page (navigation) are separate.
import { appErr, requireStr, pageOfNode } from './util.js';

const state = {
  sessionId: newSessionId(),
  runId: newSessionId(),
  pageRevision: 0,
};
let token = null;

export function newSessionId() {
  return Date.now().toString(36) + '-' + Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('');
}
export function getState() { return state; }
export function rotateSession() {
  state.sessionId = newSessionId();
  state.pageRevision++;
  return state.sessionId;
}
export function bumpPageRevision() {
  state.pageRevision++;
  return state.pageRevision;
}
export function getToken() { return token; }
export function setToken(value) { token = value; }

export function getContext() {
  const pageName = String(figma.currentPage.name);
  const fileName = String(figma.root.name);
  const context = {
    sessionId: state.sessionId, runId: state.runId,
    pageId: figma.currentPage.id, pageName: pageName.slice(0, 256),
    fileName: fileName.slice(0, 256), editorType: figma.editorType, pageRevision: state.pageRevision,
    ...(pageName.length > 256 ? { pageNameTruncated: true } : {}),
    ...(fileName.length > 256 ? { fileNameTruncated: true } : {}),
  };
  if (figma.fileKey !== undefined && figma.fileKey !== null && typeof figma.fileKey === 'string') {
    context.fileKey = figma.fileKey;
  }
  return context;
}

export function assertTarget(t) {
  if (t.sessionId !== state.sessionId) throw appErr('SESSION_CHANGED', '插件授权会话已变化，请重新读取状态');
  if (t.pageId !== figma.currentPage.id) throw appErr('PAGE_CHANGED', '目标页面已变化，请重新读取状态');
  if (t.revision !== state.pageRevision) throw appErr('PAGE_CHANGED', '页面修订已变化，请重新读取状态');
  if (t.runId !== state.runId) throw appErr('RUN_CHANGED', '插件运行实例已变化');
}

// Page-switching legitimately changes the page; only the authorization
// generation and plugin run must survive a standalone context operation.
export function assertAuthGeneration(t) {
  if (t.sessionId !== state.sessionId) throw appErr('SESSION_CHANGED', '插件授权会话已变化，请重新读取状态');
  if (t.runId !== state.runId) throw appErr('RUN_CHANGED', '插件运行实例已变化');
}

export function makeTarget(msg) {
  // pageRevision defaults to the current value so a legacy caller that only
  // knows sessionId/pageId keeps working; the bridge enforces pageRevision.
  return {
    sessionId: msg.sessionId, pageId: msg.pageId, runId: msg.runId || state.runId,
    revision: Number.isSafeInteger(msg.pageRevision) ? msg.pageRevision : state.pageRevision,
    mutating: false, affected: [],
  };
}

export async function getNode(id, t, { allowContainer = false } = {}) {
  requireStr(id, 'id');
  const node = await figma.getNodeByIdAsync(id);
  assertTarget(t);
  if (!node || node.removed) throw appErr('NODE_NOT_FOUND', `找不到节点: ${id}`);
  if (!allowContainer && (node.type === 'DOCUMENT' || node.type === 'PAGE')) throw appErr('INVALID_TARGET', '请使用页面上下文接口读取页面');
  if (!pageOfNode(node) || pageOfNode(node).id !== t.pageId) throw appErr('PAGE_CHANGED', '节点不在当前授权页面');
  return node;
}

export function markMutation(t, node) {
  assertTarget(t);
  if (node && (node.removed || !pageOfNode(node) || pageOfNode(node).id !== t.pageId)) throw appErr('PAGE_CHANGED', '节点已移出当前授权页面或被移除');
  t.mutating = true;
  if (node && !t.affected.includes(node.id)) t.affected.push(node.id);
}

export function readContextFor(msg) {
  return getContext();
}
