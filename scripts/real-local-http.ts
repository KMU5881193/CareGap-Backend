import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
let token='';
async function call(path:string,body?:unknown){const r=await fetch('http://127.0.0.1:4322'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body?JSON.stringify(body):undefined});const result=await r.json() as any;assert(r.ok,JSON.stringify(result));return result.data;}
const credentials={identifier:randomBytes(8).toString('hex'),password:randomBytes(20).toString('hex')};
await call('/api/auth/register',credentials);token=(await call('/api/auth/login',credentials)).access_token;
const person=(await call('/api/persons',{})).person_id;
const source=process.argv[2] as 'stt'|'ocr';
const bytes=await readFile(source==='stt'?'scripts/new-synthetic.wav':'scripts/new-synthetic.png');
const job=await call(`/api/${source}/jobs`,{person_id:person,request_key:randomBytes(12).toString('hex'),filename:source==='stt'?'synthetic.wav':'synthetic.png',mimeType:source==='stt'?'audio/wav':'image/png',base64:bytes.toString('base64')});
for(let i=0;i<120;i++){const result=await call(`/api/${source}/jobs/${job.id}`);if(result.status==='failed')throw Error(JSON.stringify(result));if(result.status==='succeeded'){console.log(JSON.stringify({source,stage:'original_model_output',result},null,2));break;}await new Promise(r=>setTimeout(r,1000));if(i===119)throw Error('TIMEOUT');}
const corrected=source==='stt'?{expected_version:0,segments:[{start_ms:0,end_ms:8175,speaker_id:'unknown',text:'오늘 식사는 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 두 번 했습니다.'}]}:{expected_version:0,text:'오늘 식사는 세 번 했고 약을 빠뜨리지 않았습니다.'};
await call(`/api/${source}/jobs/${job.id}/corrections`,corrected);
await call(`/api/${source}/jobs/${job.id}/confirmation`,{expected_version:1});
console.log(JSON.stringify({source,stage:'synthetic_test_correction_then_confirmed_record_import',record:await call('/api/records/import',{source,job_id:job.id})},null,2));
