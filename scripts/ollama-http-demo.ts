import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
let token='';const start=Date.now();
async function call(path:string,body?:unknown){const r=await fetch('http://127.0.0.1:4322'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':randomBytes(12).toString('hex')},body:body?JSON.stringify(body):undefined});const result=await r.json() as any;assert(r.ok,JSON.stringify(result));return result.data ?? result;}
const c={identifier:randomBytes(8).toString('hex'),password:randomBytes(20).toString('hex')};await call('/api/auth/register',c);token=(await call('/api/auth/login',c)).access_token;
const person=(await call('/api/persons',{})).person_id;
const texts=['하루 세 번 식사했고 매일 약을 복용했습니다. 산책은 주 한 번 했습니다.','하루 두 번 식사했고 이틀 약을 복용하지 않았습니다. 산책은 주 두 번 했습니다.'];
const rows=[];for(const text of texts)rows.push(await call('/api/records',{person_id:person,text}));
const ref=(r:any)=>({consultation_id:r.consultation_id,record_version_id:r.record_version_id});
for(let i=0;i<3;i++){
if(i>0){rows.length=0;for(const text of texts)rows.push(await call('/api/records',{person_id:person,text}));}
const t=Date.now();const a=await call('/api/analyses',{person_id:person,past:[ref(rows[0])],current:ref(rows[1])});assert.equal(a.status,'succeeded',JSON.stringify(a));
assert.deepEqual(a.original.findings.map((f:any)=>f.change),['worsened','worsened','improved'],'Semantic evaluation failed: stop before approval');
await call(`/api/analysis-reviews/${a.id}`,{action:'submit',expected_version:1});await call(`/api/analysis-reviews/${a.id}`,{action:'approve',expected_version:2});
const w=await call('/api/welfare-recommendations',{analysis_id:a.id,expected_analysis_version:3,confirmations:[{need:'meal_support',finding_index:0,evidence_index:0,confirmed:true}]});
console.log(JSON.stringify({iteration:i+1,elapsed_ms:Date.now()-t,provider_kind:a.provider_kind,draft:a.original ?? a.draft,analysis:a,candidate_count:w.data?.candidates?.length ?? w.candidates?.length,total_ms:Date.now()-start}));
}
