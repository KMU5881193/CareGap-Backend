import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let token='';const start=Date.now();
async function call(path:string,body?:unknown){const r=await fetch((process.env.API_BASE_URL ?? 'http://127.0.0.1:4322')+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':randomBytes(12).toString('hex')},body:body?JSON.stringify(body):undefined});const result=await r.json() as any;assert(r.ok,JSON.stringify(result));return result.data ?? result;}
const c={identifier:randomBytes(8).toString('hex'),password:randomBytes(20).toString('hex')};await call('/api/auth/register',c);token=(await call('/api/auth/login',c)).access_token;
const person=(await call('/api/persons',{})).person_id;
if(process.argv.includes('--insufficient')){
const r=[];for(const text of ['하루 3회 식사했습니다.','식사 횟수는 확인하지 못했습니다.'])r.push(await call('/api/records',{person_id:person,text}));
const a=await call('/api/analyses',{person_id:person,past:[{consultation_id:r[0].consultation_id,record_version_id:r[0].record_version_id}],current:{consultation_id:r[1].consultation_id,record_version_id:r[1].record_version_id}});
assert.equal(a.status,'failed');assert.equal(a.error_code,'INVALID_ANALYSIS');
for(const path of [`/api/analysis-reviews/${a.id}`,'/api/welfare-recommendations']){const response=await fetch((process.env.API_BASE_URL ?? 'http://127.0.0.1:4322')+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(path.includes('reviews')?{action:'submit',expected_version:1}:{analysis_id:a.id,expected_analysis_version:1,confirmations:[{need:'meal_support',finding_index:0,evidence_index:0,confirmed:true}]})});assert(!response.ok);console.log(JSON.stringify({path,status:response.status,body:await response.json()}));}
console.log(JSON.stringify({scenario:'insufficient',status:a.status,error_code:a.error_code,approval_and_welfare:'blocked',elapsed_ms:Date.now()-start}));process.exit(0);
}
const texts=['하루 세 번 식사했고 매일 약을 복용했습니다. 산책은 주 한 번 했습니다.','하루 두 번 식사했고 이틀 약을 복용하지 않았습니다. 산책은 주 두 번 했습니다.'];
const rows=[];for(const text of texts)rows.push(await call('/api/records',{person_id:person,text}));
if(process.argv.includes('--stt')){
const job=await call('/api/stt/jobs',{person_id:person,request_key:randomBytes(12).toString('hex'),filename:'new-synthetic.wav',mimeType:'audio/wav',base64:(await readFile('scripts/new-synthetic.wav')).toString('base64')});
let result:any;for(let n=0;n<100;n++){result=await call(`/api/stt/jobs/${job.id}`);if(result.status==='succeeded')break;if(result.status==='failed')throw Error(JSON.stringify(result));await new Promise(r=>setTimeout(r,1000));}assert.equal(result.status,'succeeded');console.log(JSON.stringify({stage:'real_stt_original',original:result.original}));
const correction='오늘 식사는 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 두 번 했습니다.';
await call(`/api/stt/jobs/${job.id}/corrections`,{expected_version:0,segments:[{start_ms:0,end_ms:8175,speaker_id:'unknown',text:correction}]});await call(`/api/stt/jobs/${job.id}/confirmation`,{expected_version:1});
rows[0]=await call('/api/records',{person_id:person,text:'어제 식사는 두 번 했습니다. 약을 빠뜨렸습니다. 산책은 한 번 했습니다.'});rows[1]=await call('/api/records/import',{source:'stt',job_id:job.id});
}
const ref=(r:any)=>({consultation_id:r.consultation_id,record_version_id:r.record_version_id});
for(let i=0;i<(process.argv.includes('--stt')?1:3);i++){
if(i>0){rows.length=0;for(const text of texts)rows.push(await call('/api/records',{person_id:person,text}));}
const t=Date.now();const a=await call('/api/analyses',{person_id:person,past:[ref(rows[0])],current:ref(rows[1])});assert.equal(a.status,'succeeded',JSON.stringify(a));
assert.deepEqual(a.original.findings.map((f:any)=>f.change),process.argv.includes('--stt')?['improved','improved','improved']:['worsened','worsened','improved'],'Semantic evaluation failed: stop before approval');
await call(`/api/analysis-reviews/${a.id}`,{action:'submit',expected_version:1});await call(`/api/analysis-reviews/${a.id}`,{action:'approve',expected_version:2});
const w=await call('/api/welfare-recommendations',{analysis_id:a.id,expected_analysis_version:3,confirmations:[{need:'meal_support',finding_index:0,evidence_index:0,confirmed:true}]});
console.log(JSON.stringify({iteration:i+1,elapsed_ms:Date.now()-t,provider_kind:a.provider_kind,draft:a.original ?? a.draft,analysis:a,candidate_count:w.data?.candidates?.length ?? w.candidates?.length,total_ms:Date.now()-start}));
}
