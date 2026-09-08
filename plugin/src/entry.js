// Plugin main-thread entry: dispatch, serialized execution, operation
// records, jobs, batch and capability aggregation. Bundled into plugin/code.js.
import { TOOLS, isWriteCall } from '../../shared/tool-registry.js';
import { validateSchema } from '../../shared/schema-validator.js';
import { appErr, requireStr, isPlainObject } from './util.js';
import { getContext, assertTarget, assertAuthGeneration, makeTarget, rotateSession, bumpPageRevision } from './context.js';
import { canonical, operationCapacity, reserveOperation, getOperation, operationRecordKey,
  createJob, getJob, updateJob, addOperationBytes, operationBudgetAvailable, clearAllRecords } from './records.js';
import { handlers as readHandlers } from './read.js';
import { handlers as editHandlers } from './edit.js';
import { handlers as pageHandlers } from './pages.js';
import { handlers as readLayerHandlers } from './read-layer.js';
import { handlers as assetHandlers, startVideoJob, schemas as assetSchemas } from './assets.js';
import { handlers as hierarchyHandlers } from './hierarchy.js';
import { handlers as vectorHandlers } from './vector.js';
import { handlers as layoutHandlers } from './layout.js';
import { handlers as textRangeHandlers } from './text-range.js';
import { handlers as visualHandlers } from './visual.js';
import { handlers as designSystemHandlers } from './design-system.js';
import { handlers as prototypeHandlers } from './prototype.js';
import { handleBatch } from './batch.js';
import { handlers as motionHandlers } from './motion.js';
import { handlers as figjamHandlers } from './figjam.js';
import { handlers as slidesHandlers } from './slides.js';
import { capabilityReport } from './capabilities.js';

export const HANDLERS = {
  ...readHandlers, ...editHandlers, ...pageHandlers, ...readLayerHandlers,
  ...assetHandlers, ...hierarchyHandlers, ...vectorHandlers, ...layoutHandlers,
  ...textRangeHandlers, ...visualHandlers, ...designSystemHandlers,
  ...prototypeHandlers, ...motionHandlers, ...figjamHandlers, ...slidesHandlers,
  batch: handleBatch, getCapabilities: capabilityReport,
};

// ---- schema per command (target/operationId handled outside the plugin) ----
const pluginSchemas = new Map();
export function pluginSchemaFor(command) {
  if (pluginSchemas.has(command)) return pluginSchemas.get(command);
  const tool = Object.values(TOOLS).find(t => t.command === command);
  if (!tool) return null;
  const override = SCHEMA_OVERRIDES[command];
  const source = override || tool.inputSchema;
  const schema = JSON.parse(JSON.stringify(source));
  for (const key of ['sessionId', 'pageId', 'pageRevision', 'operationId']) delete schema.properties[key];
  // The bridge maps the tool-level nodeId to the wire-level id.
  if (Object.prototype.hasOwnProperty.call(schema.properties, 'nodeId')) {
    schema.properties.id = schema.properties.nodeId;
    delete schema.properties.nodeId;
  }
  let required = (schema.required || []).filter(k => !['sessionId', 'pageId', 'pageRevision', 'operationId'].includes(k));
  required = required.map(k => (k === 'nodeId' ? 'id' : k));
  if (required.length) schema.required = required; else delete schema.required;
  delete schema.allOf;
  pluginSchemas.set(command, schema);
  return schema;
}
const SCHEMA_OVERRIDES = { ...(assetSchemas || {}) };

// ---- global runtime state --------------------------------------------------
let queue = Promise.resolve();
const postToUi = value => figma.ui.postMessage(value);
const uploads = new Map();

export function publishContext() { postToUi({ type: 'context', context: getContext() }); }
export function registerUpload(id, transferId, operationId, totalBytes, data, meta = {}) {
  return new Promise((resolve, reject) => {
    uploads.set(id, { transferId, operationId, totalBytes, data, meta, resolve, reject });
    postToUi({
      type: 'transfer_upload', id, transferId, operationId, totalBytes, data,
      ...(meta.format ? { format: meta.format } : {}), ...(meta.mime ? { mime: meta.mime } : {}),
      ...(meta.width !== undefined ? { width: meta.width } : {}), ...(meta.height !== undefined ? { height: meta.height } : {}),
    });
  });
}
export function resolveUpload(id, ok, errorMessage) {
  const upload = uploads.get(id);
  if (!upload) return;
  uploads.delete(id);
  if (ok) upload.resolve({ transferId: upload.transferId });
  else upload.reject(appErr('TRANSFER_FAILED', errorMessage || '资源传输失败'));
}

function failure(e, t) {
  return { ok: false, error: { code: e.code || 'PLUGIN_ERROR', message: e.message || String(e),
    state: e.state || (t.mutating ? 'unknown' : 'not_started'), affectedNodeIds: t.affected,
    ...(e.details ? { details: e.details } : {}),
    ...(e.batchResults ? { details: { ...e.details, steps: e.batchResults } } : {}) } };
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = sanitize(value[key]);
    }
    return out;
  }
  return value;
}

async function execute(msg, t) {
  try {
    assertTarget(t);
    if (!Object.prototype.hasOwnProperty.call(HANDLERS, msg.command)) throw appErr('UNKNOWN_COMMAND', '未知命令');
    if (!isPlainObject(msg.params)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    msg.params = sanitize(msg.params);
    const schema = pluginSchemaFor(msg.command);
    if (schema) {
      try { validateSchema(msg.params, schema); }
      catch (e) { throw appErr('INVALID_PARAM', e.message); }
    }
    const write = isWriteCall(msg.command, msg.params);
    if (write && (typeof msg.operationId !== 'string' || !msg.operationId || msg.operationId.length > 128)) {
      throw appErr('INVALID_PARAM', '写入缺少 operationId');
    }
    const data = await HANDLERS[msg.command](msg.params, t, msg);
    return { ok: true, data: write
      ? { ...data, state: 'succeeded', operationId: msg.operationId, affectedNodeIds: t.affected } : data };
  } catch (e) { return failure(e, t); }
}

async function runVideoJob(msg) {
  const job = getJob(msg.operationId);
  if (!job) return;
  updateJob(msg.operationId, { state: 'running' });
  const t = makeTarget(msg);
  // The artifact uploader binds chunks to the job's operationId so the bridge
  // can persist the MP4 when the chunk stream completes.
  t.operationId = msg.operationId;
  try {
    const result = await startVideoJob(msg.params, t);
    updateJob(msg.operationId, { state: 'succeeded', result });
  } catch (e) {
    updateJob(msg.operationId, { state: 'failed', result: { error: { code: e.code || 'PLUGIN_ERROR', message: e.message || String(e) } } });
  }
}

async function dispatch(msg) {
  const t = makeTarget(msg);
  const reply = r => postToUi({ type: 'exec_result', id: msg.id, ...r });
  if (msg.command === 'ping') {
    try { reply({ ok: true, data: { pong: true, ...getContext() } }); }
    catch (e) { reply(failure(e, t)); }
    return;
  }
  // Reconciliation must survive page switches: only the authorization
  // generation has to still hold (contract §6.1), never the live page.
  if (msg.command === 'getOperation') {
    try {
      assertAuthGeneration(t);
      requireStr(msg.params.operationId, 'operationId');
      const id = msg.params.operationId;
      if (id.length > 128) throw appErr('INVALID_PARAM', 'operationId 过长');
      const job = getJob(id);
      if (job) {
        if (job.target && job.target.sessionId !== msg.sessionId) throw appErr('OPERATION_TARGET_MISMATCH', '操作属于另一目标');
        reply({ ok: true, data: { operationId: id, state: job.state, jobId: id, result: job.result } });
        return;
      }
      const rec = getOperation(id);
      if (rec && rec.sessionId !== msg.sessionId) {
        reply(failure(appErr('OPERATION_TARGET_MISMATCH', '操作属于另一目标'), t));
        return;
      }
      reply({ ok: true, data: rec ? { operationId: id, state: rec.state, result: rec.result || null }
        : { operationId: id, state: 'not_found' } });
    } catch (e) { reply(failure(e, t)); }
    return;
  }
  try { assertTarget(t); } catch (e) { reply(failure(e, t)); return; }
  if (msg.command === 'exportVideo') {
    try {
      if (!isPlainObject(msg.params)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
      validateSchema(msg.params, pluginSchemaFor('exportVideo'));
      const id = requireStr(msg.operationId, 'operationId');
      const existing = getJob(id);
      if (existing) {
        // Same operationId with a different plan is a conflict, never a silent reuse.
        if (canonical(existing.params) !== canonical(msg.params)) {
          throw appErr('OPERATION_CONFLICT', '同一个 operationId 不能用于不同操作');
        }
        reply({ ok: true, data: { operationId: id, state: existing.state, jobId: id, result: existing.result, ...getContext() } });
        return;
      }
      createJob(id, { params: msg.params, target: { sessionId: msg.sessionId, pageId: msg.pageId } });
      reply({ ok: true, data: { state: 'accepted', jobId: id, ...getContext() } });
      void runVideoJob(msg);
    } catch (e) { reply(failure(e, t)); }
    return;
  }
  const write = isWriteCall(msg.command, msg.params);
  if (!write) {
    const task = queue.then(() => execute(msg, t));
    queue = task.then(() => undefined, () => undefined);
    reply(await task);
    return;
  }
  try {
    const id = requireStr(msg.operationId, 'operationId');
    if (id.length > 128) throw appErr('INVALID_PARAM', 'operationId 过长');
    if (!isPlainObject(msg.params)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    const signature = operationRecordKey(id, msg.sessionId, msg.pageId, msg.command, msg.params);
    let rec = getOperation(id);
    if (rec) {
      if (rec.signature !== signature) throw appErr('OPERATION_CONFLICT', '同一个 operationId 不能用于不同操作');
      reply(await rec.promise);
      return;
    }
    const reserve = signature.length * 2 + 1024;
    operationCapacity(reserve);
    rec = { signature, sessionId: msg.sessionId, pageId: msg.pageId, state: 'queued', result: null, reserve };
    reserveOperation(id, rec);
    rec.promise = queue.then(async () => {
      rec.state = 'running';
      const result = operationBudgetAvailable()
        ? await execute(msg, t)
        : failure(appErr('OPERATION_CAPACITY', '操作记录已满，请对账后重开插件'), t);
      rec.result = result;
      addOperationBytes(JSON.stringify(result).length * 2 - 2048);
      rec.state = result.ok ? 'succeeded' : result.error.state === 'partial' ? 'partial' : result.error.state === 'unknown' ? 'unknown' : 'failed';
      return result;
    });
    queue = rec.promise.then(() => undefined, () => undefined);
    reply(await rec.promise);
  } catch (e) { reply(failure(e, t)); }
}

// ---- UI message loop -------------------------------------------------------
const BRIDGE_URL = 'ws://localhost:9753/plugin';
const AUTH_TOKEN_KEY = 'bridgeToken';

figma.showUI(__html__, { width: 380, height: 520 });
postToUi({ type: 'init', context: getContext(), bridgeUrl: BRIDGE_URL });
figma.on('currentpagechange', () => {
  bumpPageRevision();
  postToUi({ type: 'context', context: getContext() });
});

figma.ui.onmessage = async msg => {
  if (!isPlainObject(msg)) return;
  if (msg.type === 'exec' && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
    await dispatch(msg);
    return;
  }
  if (msg.type === 'import_asset_request' && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
    const exec = {
      type: 'exec', id: msg.id, sessionId: msg.sessionId, pageId: msg.pageId,
      pageRevision: msg.pageRevision, command: 'importAsset', params: msg.params,
      ...(msg.operationId === undefined ? {} : { operationId: msg.operationId }),
    };
    await dispatch(exec);
    return;
  }
  if (msg.type === 'transfer_upload_done') {
    resolveUpload(msg.id, msg.ok === true, msg.error);
    return;
  }
  if (msg.type === 'revoke') {
    rotateSession();
    bumpPageRevision();
    clearAllRecords();
    postToUi({ type: 'context', context: getContext() });
    return;
  }
  if (msg.type === 'getToken') {
    postToUi({ type: 'context', context: getContext() });
    try {
      const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
      postToUi({ type: 'token', token: typeof t === 'string' && /^[a-f0-9]{64}$/.test(t) ? t : '' });
    } catch (e) { postToUi({ type: 'token', token: '', error: '无法读取本地配对信息' }); }
  } else if (msg.type === 'saveToken') {
    try {
      if (typeof msg.token !== 'string' || !/^[a-f0-9]{64}$/.test(msg.token)) throw new Error('配对密钥格式错误');
      await figma.clientStorage.setAsync(AUTH_TOKEN_KEY, msg.token);
      postToUi({ type: 'saved', ok: true });
    } catch (e) { postToUi({ type: 'saved', ok: false, error: e.message }); }
  } else if (msg.type === 'clearToken') {
    try { await figma.clientStorage.deleteAsync(AUTH_TOKEN_KEY); postToUi({ type: 'tokenCleared', ok: true }); }
    catch (e) { postToUi({ type: 'tokenCleared', ok: false, error: e.message }); }
  }
};
