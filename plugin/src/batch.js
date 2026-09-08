// Sequential multi-step batch over registered commands. Steps may reference
// prior creation results via the string form "step{index}.id".
import { LIMITS, BATCH_EXCLUDED_COMMANDS } from '../../shared/limits.js';
import { isWriteCall } from '../../shared/tool-registry.js';
import { appErr, isPlainObject } from './util.js';
import { assertTarget } from './context.js';
import { HANDLERS, pluginSchemaFor } from './entry.js';
import { validateSchema } from '../../shared/schema-validator.js';

const REF = /^step(\d+)\.id$/;

function collectRefs(params, out = []) {
  if (typeof params === 'string') {
    const match = params.match(REF);
    if (match) out.push(Number(match[1]));
  } else if (Array.isArray(params)) {
    for (const item of params) collectRefs(item, out);
  } else if (isPlainObject(params)) {
    for (const key of Object.keys(params)) collectRefs(params[key], out);
  }
  return out;
}

function substituteRefs(params, results) {
  if (typeof params === 'string') {
    const match = params.match(REF);
    if (match) {
      const step = results[Number(match[1])];
      if (!step || typeof step.id !== 'string') throw appErr('BATCH_REF', `引用 step${match[1]}.id 不可用`);
      return step.id;
    }
    return params;
  }
  if (Array.isArray(params)) return params.map(item => substituteRefs(item, results));
  if (isPlainObject(params)) {
    const out = {};
    for (const key of Object.keys(params)) out[key] = substituteRefs(params[key], results);
    return out;
  }
  return params;
}

export async function handleBatch(p, t) {
  if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > LIMITS.BATCH_STEPS) {
    throw appErr('INVALID_PARAM', `steps 数量必须在 1–${LIMITS.BATCH_STEPS}`);
  }
  // Validate every step before the first side effect.
  const plans = p.steps.map((step, index) => {
    if (!isPlainObject(step) || typeof step.command !== 'string' || !isPlainObject(step.params)) {
      throw appErr('INVALID_PARAM', `step${index} 必须是 {command, params}`);
    }
    if (BATCH_EXCLUDED_COMMANDS.has(step.command) || step.command === 'batch') {
      throw appErr('BATCH_FORBIDDEN', `${step.command} 不能放入 batch`);
    }
    if (!Object.prototype.hasOwnProperty.call(HANDLERS, step.command)) {
      throw appErr('BATCH_FORBIDDEN', `未知命令: ${step.command}`);
    }
    const refs = collectRefs(step.params);
    for (const ref of refs) if (ref >= index || ref < 0) throw appErr('BATCH_REF', `step${index} 引用不存在的 step${ref}`);
    const schema = pluginSchemaFor(step.command);
    if (schema) {
      try { validateSchema(step.params, schema); }
      catch (e) { throw appErr('INVALID_PARAM', `step${index} 参数不合法: ${e.message}`); }
    }
    return step;
  });
  const results = [];
  const stepResults = [];
  for (let index = 0; index < plans.length; index++) {
    const step = plans[index];
    try {
      assertTarget(t);
      const params = substituteRefs(step.params, stepResults);
      const data = await HANDLERS[step.command](params, t, { operationId: null });
      stepResults.push(data);
      results.push({ step: index, command: step.command, status: 'succeeded', data });
    } catch (e) {
      results.push({ step: index, command: step.command, status: 'failed',
        error: { code: e.code || 'PLUGIN_ERROR', message: e.message || String(e) } });
      if (p.continueOnError !== true) {
        for (let rest = index + 1; rest < plans.length; rest++) {
          results.push({ step: rest, command: plans[rest].command, status: 'not_started' });
        }
        // Every step status is recorded, so the batch state is deterministically failed.
        throw Object.assign(appErr('BATCH_STOPPED', `step${index} 失败，batch 已停止`), { state: 'failed', batchResults: results });
      }
    }
  }
  return { steps: results, affectedNodeIds: t.affected };
}
