import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OllamaVisionProvider} from '../src/modules/be3-intelligence/ollama-vision-provider.js';
const base='http://127.0.0.1:4334';const rows=JSON.parse(await readFile('.runtime/demo-credentials.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:rows[0].identifier,password:rows[0].password})});assert.equal(login.status,200);const token=(await login.json() as any).data.access_token;
const evidence:any[]=[];
for(const ext of ['png','jpg']){
 const bytes=await readFile(`.runtime/vision-synthetic.${ext}`);const mimeType=ext==='png'?'image/png':'image/jpeg';
 const payload={person_id:rows[2].person_id,filename:`vision-synthetic.${ext}`,mimeType,base64:bytes.toString('base64')};
 const r=await fetch(base+'/api/vision/analyses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':`final-direct-${ext}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(150000)});const response=await r.json();evidence.push({kind:'http',mimeType,status:r.status,response});
 await writeFile('.runtime/vision-evidence.json',JSON.stringify(evidence,null,2));assert.equal(r.status,201,JSON.stringify(response));assert.equal((response as any).data.provenance.ocr_used,false);
 // Observe the real outgoing provider request, then forward it to real Ollama.
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));assert.equal(String(input),'http://127.0.0.1:11434/api/chat');assert.equal(body.messages[1].images[0],bytes.toString('base64'));assert(!body.messages[1].content.includes('오늘 식사'));evidence.push({kind:'actual_provider_transport',mimeType,url:String(input),images_count:body.messages[1].images.length,original_bytes_equal:true,ocr_used:false});return originalFetch(input,init);};
 try{const output=await new OllamaVisionProvider().analyze(bytes,mimeType,AbortSignal.timeout(120000));evidence.push({kind:'actual_provider_output',mimeType,output});}finally{globalThis.fetch=originalFetch;await writeFile('.runtime/vision-evidence.json',JSON.stringify(evidence,null,2));}
}
console.log(JSON.stringify(evidence,null,2));
