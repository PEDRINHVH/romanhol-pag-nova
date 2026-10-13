import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const envPath = join(root, '.env.local');
const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const needles = Object.entries(env).filter(([key,value])=>/(TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key)&&value.length>=8).map(([,value])=>Buffer.from(value));
const matches=[];
function scan(directory) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const file=join(directory,entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.isFile()) {
      if (/^\.(?:env|dev\.vars)(?:\.|$)/.test(entry.name) || needles.some(value=>readFileSync(file).includes(value))) matches.push(file);
    } else matches.push(file);
  }
}
scan(join(root,'dist'));
if(matches.length){console.error('Forbidden credential content or non-regular files:',matches);process.exitCode=1;}
else console.log('Build credential scan passed; no secret values or environment files found.');
