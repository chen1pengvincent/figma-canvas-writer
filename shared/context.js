// Context shape shared by bridge, plugin main thread and plugin UI.
// The handshake signs this object, so the rules below are part of protocol 3.
import { CONTEXT_KEYS, CONTEXT_OPTIONAL_KEYS, EDITOR_TYPES } from './limits.js';

const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);

export function normalizeContext(value, { allowLegacy = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少插件上下文');
  const out = {};
  for (const key of CONTEXT_KEYS) {
    const present = own(value, key);
    const legacy = !present && allowLegacy && key === 'runId';
    const missing = !present && !legacy;
    if (missing && key !== 'pageRevision') throw new Error('无效插件上下文: ' + key);
    if (present) {
      const v = value[key];
      const isStringKey = ['sessionId', 'runId', 'pageId', 'pageName', 'fileName'].includes(key);
      if (isStringKey) {
        if (typeof v !== 'string' || v.length > 1024 || ((key === 'sessionId' || key === 'runId' || key === 'pageId') && !v)) {
          throw new Error('无效插件上下文: ' + key);
        }
      } else if (key === 'editorType') {
        if (!EDITOR_TYPES.includes(v)) throw new Error('不支持的编辑器类型: ' + v);
      } else if (key === 'pageRevision') {
        if (!Number.isSafeInteger(v) || v < 0) throw new Error('无效插件上下文: pageRevision');
      }
      out[key] = v;
    }
  }
  for (const key of CONTEXT_OPTIONAL_KEYS) {
    if (own(value, key) && value[key] !== null) {
      if (key === 'fileKey' && (typeof value[key] !== 'string' || value[key].length > 1024)) throw new Error('无效插件上下文: fileKey');
      out[key] = value[key];
    }
  }
  return out;
}

export function contextMatches(clientContext, currentContext) {
  // Tool arguments carry only sessionId/pageId/pageRevision; editorType is
  // compared only when both sides provide it (status responses do).
  if (clientContext.sessionId !== currentContext.sessionId) return false;
  if (clientContext.pageId !== currentContext.pageId) return false;
  if (clientContext.pageRevision !== currentContext.pageRevision) return false;
  if (clientContext.editorType !== undefined && currentContext.editorType !== undefined &&
      clientContext.editorType !== currentContext.editorType) return false;
  return true;
}
