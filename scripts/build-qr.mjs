import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
await build({configFile: false, publicDir: false, build: {lib: {entry: new URL('./qr-entry.mjs', import.meta.url).pathname, formats: ['es'], fileName: () => 'qr-code.js'}, outDir: 'public/vendor', emptyOutDir: false, minify: true}});
await copyFile('node_modules/qrcode/license', 'public/vendor/qrcode.LICENSE');
