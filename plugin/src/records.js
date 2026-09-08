// Operation records (dedup/reconcile), read cursors and background jobs.
// All records live in this plugin run's memory; they do not survive restart.
import { LIMITS } from '../../shared/limits.js';
import { appErr, isPlainObject } from './util.js';
import { getContext } from './context.js';

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(v => v === undefined ? 'null' : canonical(v)).join(',') + ']';
  if (isPlainObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

// ---- operation records -----------------------------------------------------
const operations = new Map();
let operationBytes = 0;

export function operationCapacity(reserve) {
  if (operations.size >= LIMITS.OPERATION_RECORDS || operationBytes + reserve > LIMITS.OPERATION_RECORD_BYTES) {
    throw appErr('OPERATION_CAPACITY', '本次插件运行操作记录已满；对账后重开插件，不会逐出旧记录再重复执行');
  }
}
export function operationBudgetAvailable() {
  return operationBytes + 196608 <= LIMITS.OPERATION_RECORD_BYTES;
}
export function reserveOperation(id, meta) {
  operationBytes += meta.reserve;
  operations.set(id, meta);
}
export function addOperationBytes(delta) { operationBytes += delta; }
export function getOperation(id) { return operations.get(id); }
export function operationRecordKey(id, sessionId, pageId, command, params) {
  return canonical({ sessionId, pageId, command, params });
}
export function operationTargetMismatch(rec, msg) {
  return rec && (rec.sessionId !== msg.sessionId || rec.pageId !== msg.pageId);
}

// ---- read cursors ----------------------------------------------------------
const cursors = new Map();
let cursorSerialBytes = 0;

export function createCursor(kind, meta) {
  pruneCursors();
  const serialized = JSON.stringify(meta);
  if (cursors.size >= LIMITS.ACTIVE_HANDLES) throw appErr('HANDLE_CAPACITY', '活动读取句柄过多，请继续消费或等待过期');
  cursorSerialBytes += serialized.length;
  if (cursorSerialBytes > LIMITS.HANDLE_BUDGET_BYTES) { cursorSerialBytes -= serialized.length; throw appErr('HANDLE_CAPACITY', '读取句柄预算耗尽'); }
  const cursorId = 'h_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  cursors.set(cursorId, {
    kind, createdAt: Date.now(), expiresAt: Date.now() + LIMITS.HANDLE_TTL_MS, meta,
    serializedBytes: serialized.length,
    runId: getContext().runId, sessionId: getContext().sessionId, pageId: getContext().pageId,
  });
  return cursorId;
}
export function readCursor(cursorId, msg) {
  const c = cursors.get(cursorId);
  if (!c) throw appErr('CURSOR_NOT_FOUND', '读取句柄不存在或已过期');
  const current = getContext();
  if (c.runId !== current.runId || c.sessionId !== current.sessionId || c.pageId !== current.pageId) {
    throw appErr('CURSOR_STALE', '读取句柄不属于当前会话/页面');
  }
  if (Date.now() > c.expiresAt) { dropCursor(cursorId); throw appErr('CURSOR_EXPIRED', '读取句柄已过期'); }
  return c;
}
export function touchCursor(cursorId) {
  const c = cursors.get(cursorId);
  if (c) c.expiresAt = Date.now() + LIMITS.HANDLE_TTL_MS;
  return c;
}
export function dropCursor(cursorId) {
  const c = cursors.get(cursorId);
  if (c) {
    cursorSerialBytes -= c.serializedBytes || 0;
    cursors.delete(cursorId);
  }
}
export function pruneCursors() {
  const now = Date.now();
  for (const [id, c] of cursors) if (now > c.expiresAt) dropCursor(id);
}
// Revocation must leave nothing queryable behind: records, cursors and jobs
// all die with the session so old operationIds can no longer be reconciled.
export function clearAllRecords() {
  for (const id of [...operations.keys()]) operations.delete(id);
  operationBytes = 0;
  for (const id of [...cursors.keys()]) dropCursor(id);
  cursorSerialBytes = 0;
  for (const id of [...jobs.keys()]) jobs.delete(id);
}

// ---- background jobs (video export) ----------------------------------------
const jobs = new Map();
export function createJob(operationId, meta) {
  const job = { operationId, state: 'accepted', result: null, ...meta };
  jobs.set(operationId, job);
  return job;
}
export function getJob(operationId) { return jobs.get(operationId); }
export function updateJob(operationId, patch) {
  const job = jobs.get(operationId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}
