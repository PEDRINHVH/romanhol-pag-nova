import { reconcilePayments } from './payments.mjs';

const json = (body, status) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

async function authorized(request, secret) {
  if (typeof secret !== 'string' || !secret) return false;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 4096) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [expected, received] = await Promise.all([digest(secret), digest(header.slice(7))]);
  const a = new Uint8Array(expected), b = new Uint8Array(received);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function handleMaintenanceRequest(request, env) {
  if (new URL(request.url).pathname !== '/api/internal/reconcile') return null;
  if (!await authorized(request, env.PAYMENT_RECONCILE_TOKEN)) return json({ error: 'unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const result = await reconcilePayments(env);
    return json(result, result.ok ? 200 : 503);
  } catch { return json({ ok: false, error: 'maintenance_unavailable' }, 503); }
}
