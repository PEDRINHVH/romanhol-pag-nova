import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMaintenanceRequest } from '../worker/maintenance.mjs';

const url = 'https://shop.example/api/internal/reconcile';
const token = 'maintenance-test-token';
const request = (authorization, method = 'POST') => new Request(url, { method, headers: authorization ? { authorization } : {} });

test('maintenance rejects unauthorized and wrong-method requests without side effects', async () => {
  let effects = 0;
  const env = { PAYMENT_RECONCILE_TOKEN: token, DB: { prepare() { effects++; throw new Error('must not execute'); } } };
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer ', 'Basic ' + token]) {
    assert.equal((await handleMaintenanceRequest(request(authorization), env)).status, 401);
  }
  assert.equal((await handleMaintenanceRequest(request('Bearer ' + token), { ...env, PAYMENT_RECONCILE_TOKEN: '' })).status, 401);
  assert.equal((await handleMaintenanceRequest(request('Bearer ' + token, 'GET'), env)).status, 405);
  assert.equal(effects, 0);
});

test('maintenance runs synchronously without browser origin and returns only counters', async () => {
  let queries = 0;
  const env = { PAYMENT_RECONCILE_TOKEN: token, PAYMENT_API_TOKEN: 'test-token', DB: { prepare() { return { bind() { return { async all() { await Promise.resolve(); queries++; return { results: [] }; } }; } }; } } };
  const response = await handleMaintenanceRequest(request('Bearer ' + token), env);
  assert.equal(response.status, 200);
  assert.equal(queries, 2);
  assert.deepEqual(await response.json(), { ok: true, paymentsProcessed: 0, paymentsFailed: 0, trackingProcessed: 0, trackingFailed: 0, stageFailures: 0 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('maintenance fails closed when storage is unavailable', async () => {
  const response = await handleMaintenanceRequest(request('Bearer ' + token), { PAYMENT_RECONCILE_TOKEN: token });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'maintenance_unavailable' });
});
