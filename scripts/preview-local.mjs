import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, readdirSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handlePaymentRequest, SHIPPING_OPTIONS } from '../worker/payments.mjs';
import { handleTrackingRequest } from '../worker/tracking.mjs';

const root = resolve(import.meta.dirname, '..');
try { process.loadEnvFile(resolve(root, '.env.local')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
mkdirSync(resolve(root, '.local'), {recursive:true});
const sqlite = new DatabaseSync(resolve(root, '.local/preview.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for (const name of readdirSync(resolve(root, 'drizzle')).filter(n=>n.endsWith('.sql')).sort()) {
  if (!sqlite.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name)) {
    sqlite.exec('BEGIN');
    try { sqlite.exec(readFileSync(resolve(root,'drizzle',name),'utf8')); sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name); sqlite.exec('COMMIT'); }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  }
}
const DB = {prepare(sql) { const s=sqlite.prepare(sql); const bound = (values=[])=>({ bind(...v){return bound(v);}, async first(){return s.get(...values)??null;},async all(){return {results:s.all(...values)};},async run(){return {meta:{changes:Number(s.run(...values).changes)}};}});return bound();}};
const env = {...process.env, UTMIFY_IS_TEST: 'true', DB};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:5173');
    if (url.pathname.startsWith('/api/')) {
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
      let response=await handlePaymentRequest(request,env,{waitUntil:p=>p.catch(()=>console.error('Background tracking retry deferred'))});
      if (!response && url.pathname==='/api/events') response=await handleTrackingRequest(request,env);
      if (!response && url.pathname==='/api/config') {
        response=Response.json({paymentReady:Boolean(env.PAYMENT_API_TOKEN),shippingCents:0,shippingOptions:SHIPPING_OPTIONS,pixelId:env.META_PIXEL_ID||''},{headers:{'cache-control':'no-store'}});
      }
      response??=Response.json({error:'not_found'},{status:404});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const publicRoot=resolve(root,'public'); const file=resolve(publicRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if (!file.startsWith(publicRoot+sep)) {res.writeHead(403);res.end();return;}
    const path=existsSync(file)&& (await stat(file)).isFile()?file:resolve(publicRoot,'index.html');
    res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});
    if(req.method==='HEAD')res.end();else createReadStream(path).pipe(res);
  } catch {res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"local_preview_error"}');}
}).listen(5173,'127.0.0.1',()=>console.log('Local API preview ready: http://127.0.0.1:5173 (persistent SQLite; live configured integrations)'));
