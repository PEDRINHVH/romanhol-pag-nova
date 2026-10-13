import { access, cp } from 'node:fs/promises';

await access('.next/standalone/server.js');
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
console.log('Hostinger standalone ready: .next/standalone/server.js');
