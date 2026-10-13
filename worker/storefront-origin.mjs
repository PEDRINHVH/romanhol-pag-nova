const STOREFRONT_ORIGINS = new Set([
  'https://nolimitemotos.com',
  'https://www.nolimitemotos.com',
]);

export function storefrontOrigin(request) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin || STOREFRONT_ORIGINS.has(origin) ? origin : null;
}

export function storefrontClientIp(request) {
  // Cross-origin requests arrive through the storefront proxy, whose IP is not the buyer's.
  return request.headers.get('origin') === new URL(request.url).origin
    ? request.headers.get('cf-connecting-ip')
    : null;
}
