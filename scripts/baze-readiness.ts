// Offline configuration inspection only. Never sends a request or prints a key.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const config=await readFile(join(homedir(),'.codex','config.toml'),'utf8');
const field=(name:string)=>config.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"\\r\\n]+)"`,'m'))?.[1];
const base=field('base_url');
if(base){const url=new URL(base);if(url.username||url.password||url.search)throw Error('Unsafe endpoint configuration');}
console.log(JSON.stringify({base_url:base,model:field('model'),configured_protocol:field('wire_api'),key_present:!!process.env.BAZE_API_KEY,network_calls:0,structured_outputs:'unverified',pricing:'unknown; gateway price documentation required',adapter_gaps:['explicit gateway endpoint allowlist','model alias support','synthetic-source consent registry instead of fixed fixture equality','response ID capture','strict schema capability check before analysis']},null,2));
