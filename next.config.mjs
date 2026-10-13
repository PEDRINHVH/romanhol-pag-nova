// The existing Worker owns payments, tracking credentials and persistent orders.
const checkoutOrigin = 'https://nolimit-capacetes.tarcalmix.chatgpt.site';

/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        { source: '/api/:path*', destination: `${checkoutOrigin}/api/:path*` },
      ],
    };
  },
};
