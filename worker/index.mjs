import handler from 'vinext/server/fetch-handler';
import { handlePaymentRequest, reconcilePayments } from './payments.mjs';
import { handleTrackingRequest } from './tracking.mjs';

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(reconcilePayments(env));
  },
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    const payment = await handlePaymentRequest(request, env, ctx);
    if (payment) return payment;
    if (pathname === '/api/events') return handleTrackingRequest(request, env);
    if (pathname === '/api/config') {
      const shipping = env.SHIPPING_AMOUNT_CENTS;
      const shippingCents = shipping !== undefined && shipping !== '' && Number.isSafeInteger(Number(shipping)) && Number(shipping) >= 0 ? Number(shipping) : null;
      return Response.json({ paymentReady: Boolean(env.PAYMENT_API_TOKEN && shippingCents !== null), shippingCents, pixelId: env.META_PIXEL_ID || '' }, {headers: {'cache-control': 'no-store'}});
    }
    if (pathname.startsWith('/api/')) return Response.json({error: 'not_found'}, {status: 404});
    return handler.fetch(request, env, ctx);
  },
};
