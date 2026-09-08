// Regression coverage for the adversarial-review blockers:
// B1 video artifact operationId propagation across the real plugin -> UI chain,
// B2 getOperation reconciliation across page switches, B3 batch per-step results.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makePlugin, success, failure } from './helpers/figma-vm.js';

test('B1: video job upload carries the job operationId so the bridge can persist the artifact', async () => {
  const plugin = await makePlugin();
  const mp4 = vm.runInContext('new Uint8Array(1024).fill(7)', plugin.sandbox);
  const frame = plugin.seed('FRAME', { name: 'animated' });
  frame.exportAsync = async () => mp4;
  const data = success(await plugin.send('exportVideo', { id: frame.id, format: 'MP4' }));
  assert.equal(data.state, 'accepted');
  assert.equal(data.jobId, 'test-operation-1', 'the accepted reply must echo the operationId');
  // The background job posts its upload to the UI; the header must bind the job id.
  await new Promise(resolve => setTimeout(resolve, 50));
  const upload = plugin.messages.find(m => m.type === 'transfer_upload');
  assert.ok(upload, 'the video job must stream its bytes through the UI channel');
  assert.equal(upload.operationId, 'test-operation-1');
  assert.equal(upload.totalBytes, mp4.length);
  // Simulate the UI confirming the chunk stream was accepted by the bridge.
  await plugin.post({ type: 'transfer_upload_done', id: upload.id, ok: true });
  const done = success(await plugin.send('getOperation', { operationId: 'test-operation-1' }));
  assert.equal(done.state, 'succeeded');
  assert.equal(done.jobId, 'test-operation-1');
});

test('B1b: the same operationId with a different video plan is a conflict, not a silent reuse', async () => {
  const plugin = await makePlugin();
  const frame = plugin.seed('FRAME');
  frame.exportAsync = async () => new Uint8Array(16);
  success(await plugin.send('exportVideo', { id: frame.id, format: 'MP4' }));
  const other = plugin.seed('FRAME');
  const conflict = failure(await plugin.send('exportVideo', { id: other.id, format: 'MP4' }, { operationId: 'test-operation-1' }));
  assert.equal(conflict.code, 'OPERATION_CONFLICT');
});

test('B2: a write that timed out on page A stays reconcilable after switching to page B', async () => {
  const plugin = await makePlugin();
  const created = success(await plugin.send('createNode', { type: 'RECTANGLE', name: 'late' }));
  plugin.switchPage(plugin.pageB);
  // The caller reconciles with the NEW page target and the same session.
  const reconciled = success(await plugin.send('getOperation', { operationId: 'test-operation-1' }, {
    pageId: plugin.pageB.id,
  }));
  assert.equal(reconciled.state, 'succeeded');
  assert.equal(reconciled.result.data.id, created.id);
  // A different session must not learn anything about the old operation.
  const foreign = failure(await plugin.send('getOperation', { operationId: 'test-operation-1' }, {
    sessionId: 'other-session', pageId: plugin.pageB.id,
  }));
  assert.ok(['OPERATION_TARGET_MISMATCH', 'SESSION_CHANGED'].includes(foreign.code), 'a foreign session must never see the record');
});

test('B2b: revocation wipes operation records so old ids return not_found', async () => {
  const plugin = await makePlugin();
  success(await plugin.send('createNode', { type: 'RECTANGLE' }));
  await plugin.post({ type: 'revoke' });
  const after = success(await plugin.send('getOperation', { operationId: 'test-operation-1' }, {
    sessionId: plugin.contextRef.current.sessionId, pageId: plugin.contextRef.current.pageId,
  }));
  assert.equal(after.state, 'not_found');
});

test('B3: a failed batch reports every step status inside the error details', async () => {
  const plugin = await makePlugin();
  plugin.missingFonts.add('Inter::Regular');
  const error = failure(await plugin.send('batch', {
    steps: [
      { command: 'createNode', params: { type: 'RECTANGLE', name: 'kept' } },
      { command: 'createNode', params: { type: 'TEXT', text: 'boom' } },
      { command: 'createNode', params: { type: 'ELLIPSE' } },
    ],
  }));
  assert.equal(error.code, 'BATCH_STOPPED');
  assert.ok(Array.isArray(error.details?.steps), 'per-step results must survive into the error details');
  const steps = error.details.steps;
  assert.equal(steps[0].status, 'succeeded');
  assert.equal(steps[1].status, 'failed');
  assert.equal(steps[2].status, 'not_started');
  // The same record must be queryable through getOperation afterwards.
  const op = success(await plugin.send('getOperation', { operationId: 'test-operation-1' }));
  assert.equal(op.state, 'failed');
  assert.equal(op.result.error.details.steps.length, 3);
});
