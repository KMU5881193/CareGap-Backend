import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { syntheticPast, syntheticCurrent } from '../src/modules/be3-intelligence/analysis-mock.js';
const base='http://127.0.0.1:4320';let token='';let checks=0;
async function call(path:string,body?:unknown,status=200,authenticated=true){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticated&&token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,status,`${path}: ${r.status} ${await (r.status!==status?r.clone().text():Promise.resolve(''))}`);checks++;return status===204?null:await r.json() as any;}
const password=randomBytes(24).toString('base64url');const identifier='synthetic-'+randomBytes(6).toString('hex');
await call('/api/auth/register',{identifier,password},201,false);
token=(await call('/api/auth/login',{identifier,password},200,false)).data.access_token;
await call('/api/appointments',undefined,401,false);
const person=(await call('/api/persons',{},201)).data.person_id;
const appt={person_id:person,starts_at:'2026-11-01T01:00:00Z',ends_at:'2026-11-01T02:00:00Z'};
await call('/api/appointments',appt,201);await call('/api/appointments',appt,409);await call('/api/appointments');
const past=(await call('/api/records',{person_id:person,text:syntheticPast},201)).data;
const image=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer();
const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
let current:any;
for(const source of ['ocr','stt'] as const){const bytes=source==='ocr'?image:wav;const job=(await call(`/api/${source}/jobs`,{person_id:person,request_key:randomBytes(8).toString('hex'),filename:source==='ocr'?'synthetic.png':'synthetic.wav',mimeType:source==='ocr'?'image/png':'audio/wav',base64:bytes.toString('base64')},202)).data;
 let ready=false;for(let i=0;i<100;i++){const r=(await call(`/api/${source}/jobs/${job.id}`)).data;if(r.status==='succeeded'){ready=true;break;}await new Promise(r=>setTimeout(r,20));}assert(ready,'job timeout');
 await call('/api/records/import',{source,job_id:job.id},409);
 await call(`/api/${source}/jobs/${job.id}/corrections`,source==='ocr'?{expected_version:0,text:syntheticCurrent}:{expected_version:0,segments:[{start_ms:0,end_ms:1000,speaker_id:'unknown',text:syntheticCurrent}]});
 await call(`/api/${source}/jobs/${job.id}/confirmation`,{expected_version:1});
 current=(await call('/api/records/import',{source,job_id:job.id},201)).data;
 const repeated=(await call('/api/records/import',{source,job_id:job.id},201)).data;assert.equal(current.record_version_id,repeated.record_version_id);
}
await call(`/api/records?person_id=${person}`);
const ref=(r:any)=>({consultation_id:r.consultation_id,record_version_id:r.record_version_id});
// Analysis API requires an idempotency key.
const response=await fetch(base+'/api/analyses',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomBytes(12).toString('hex')},body:JSON.stringify({person_id:person,past:[ref(past)],current:ref(current)})});assert.equal(response.status,200);const analysis=(await response.json() as any).data;assert.equal(analysis.status,'succeeded');checks++;
const needs={analysis_id:analysis.id,expected_analysis_version:3,confirmations:[{need:'meal_support',finding_index:0,evidence_index:1,confirmed:true}]};
await call('/api/welfare-recommendations',needs,409);
await call(`/api/analysis-reviews/${analysis.id}`,{action:'submit',expected_version:1});
await call(`/api/analysis-reviews/${analysis.id}`,{action:'approve',expected_version:2});
const welfare=await call('/api/welfare-recommendations',needs);assert(welfare.data.candidates.length>0);assert(welfare.data.candidates.every((c:any)=>c.eligibility_status==='unverified'));
const first=token;const other='synthetic-'+randomBytes(6).toString('hex');await call('/api/auth/register',{identifier:other,password},201,false);token=(await call('/api/auth/login',{identifier:other,password},200,false)).data.access_token;await call(`/api/records?person_id=${person}`,undefined,403);token=first;
await call('/api/auth/staff/pending',undefined,404);await call('/api/auth/logout',{},204);await call('/api/auth/me',undefined,401);
console.log(JSON.stringify({result:'PASS',http_checks:checks,base,storage:'memory',providers:'mock',flow:'login -> appointment -> OCR+STT correction/confirmation -> BE2 records -> analysis review -> welfare',security:'anonymous, cross-user, unconfirmed import, unapproved analysis, revoked token blocked'}));
