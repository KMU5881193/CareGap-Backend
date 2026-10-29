import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.API_BASE_URL??'http://127.0.0.1:4334';
// This script must never seed the protected running server.
assert.equal(base,'http://127.0.0.1:4334');
await mkdir('.runtime',{recursive:true});
const accounts=JSON.parse(await readFile('.runtime/demo-credentials.json','utf8'));
const trace:any[]=[];let token='';
const key=(s:string)=>createHash('sha256').update(s).digest('hex');
async function call(path:string,body?:any,status?:number,requestKey=key(path+JSON.stringify(body))){
 const started=Date.now();const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':requestKey},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 const value=r.status===204?null:await r.json() as any;
 if(!path.startsWith('/api/auth'))trace.push({path,status:r.status,elapsed_ms:Date.now()-started,request:body?{...body,...(body.base64?{base64:'[synthetic bytes omitted]'}:{})}:undefined,response:value});
 await writeFile('.runtime/demo-http-trace.json',JSON.stringify({base,checked_at:new Date().toISOString(),trace},null,2));
 if(status!==undefined)assert.equal(r.status,status,JSON.stringify(value));else assert(r.ok,JSON.stringify(value));return value?.data??value;
}
async function login(a:any){token=(await call('/api/auth/login',{identifier:a.identifier,password:a.password},200)).access_token;assert.equal((await call('/api/auth/me')).role,a.role);}
const ref=(r:any)=>({consultation_id:r.consultation_id,record_version_id:r.record_version_id});
let state:any={};try{state=JSON.parse(await readFile('.runtime/demo-seed-state.json','utf8'));}catch{}
async function save(){await writeFile('.runtime/demo-seed-state.json',JSON.stringify(state,null,2));}
const pastTexts=['[합성 데모] 과거에는 식사를 하루 두 번 했습니다. 약을 빠뜨렸습니다. 산책은 일주일에 한 번 했습니다.','[합성 데모] 과거에는 식사를 하루 세 번 했습니다. 외출은 일주일에 세 번 했습니다.'];
const currentTexts=['[합성 데모] 현재 식사는 하루 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 일주일에 두 번 했습니다.','[합성 데모] 현재 식사는 하루 두 번 했습니다. 외출은 일주일에 한 번 했습니다.'];
const summary:any[]=[];
for(let i=0;i<2;i++){
 const staff=accounts[i],patient=accounts[i+2],person_id=patient.person_id;state[person_id]??={};const s=state[person_id];await login(staff);
 for(const [date,completed] of [['2026-10-28',true],['2026-11-02',false]] as const){let rows=await call('/api/appointments');let ap=rows.find((r:any)=>r.person_id===person_id&&r.starts_at===`${date}T01:00:00Z`);if(!ap)ap=await call('/api/appointments',{person_id,starts_at:`${date}T01:00:00Z`,ends_at:`${date}T02:00:00Z`},201);if(completed&&ap.status==='scheduled')await call(`/api/appointments/${ap.appointment_id}/actions`,{action:'complete',expected_status:'scheduled'});}
 let records=await call(`/api/records?person_id=${person_id}`);let past=records.find((r:any)=>r.text===pastTexts[i]);if(!past)past=await call('/api/records',{person_id,text:pastTexts[i]},201);
 for(const source of ['ocr','stt']){
  const filename=source==='ocr'?`person-${i}-synthetic.png`:`person-${i}.wav`;const body={person_id,request_key:`demo-${source}-${i}`,filename,mimeType:source==='ocr'?'image/png':'audio/wav',base64:(await readFile('.runtime/'+filename)).toString('base64')};
  let job:any;if(s[source]){try{job=await call(`/api/${source}/jobs/${s[source]}`);}catch{}}
  if(!job){job=await call(`/api/${source}/jobs`,body,202);s[source]=job.id;await save();}
  for(let n=0;n<150&&['pending','processing'].includes(job.status);n++){await new Promise(r=>setTimeout(r,500));job=await call(`/api/${source}/jobs/${job.id}`);}
  if(job.status!=='succeeded'){s[`${source}_failure`]=job;await save();console.log(`${i} ${source}: ${job.status}`);continue;}
  if(job.version===0)job=await call(`/api/${source}/jobs/${job.id}/corrections`,source==='ocr'?{expected_version:0,text:currentTexts[i]}:{expected_version:0,segments:[{start_ms:job.original.segments[0].start_ms,end_ms:job.original.segments.at(-1).end_ms,speaker_id:'unknown',text:currentTexts[i]}]});
  if(!job.confirmed)await call(`/api/${source}/jobs/${job.id}/confirmation`,{expected_version:job.version});
  const imported=await call('/api/records/import',{source,job_id:job.id},201);s[`${source}_record`]=imported;await save();
 }
 // Two extraction paths are independent; prefer STT for the comparison source.
 const current=s.stt_record??s.ocr_record;assert(current,'NO_CONFIRMED_CURRENT_RECORD');
 let analysis:any;if(s.analysis_id){try{analysis=await call(`/api/analyses/${s.analysis_id}`);}catch{}}
 if(!analysis){analysis=await call('/api/analyses',{person_id,past:[ref(past)],current:ref(current)});s.analysis_id=analysis.id;await save();}
 s.analysis_status=analysis.status;
 if(analysis.status==='succeeded'){
  assert.equal(analysis.provider_metadata.provider,'ollama');assert(analysis.inference.eval_count>0);
  for(const f of analysis.original.findings)for(const e of f.evidence){const record=[past,current].find(r=>r.record_version_id===e.record_version_id);assert(record&&record.consultation_id===e.consultation_id&&record.text.includes(e.quote));}
  // Automated synthetic demo review; this is not a human clinical approval.
  if(analysis.review_state==='draft')analysis=await call(`/api/analysis-reviews/${analysis.id}`,{action:'submit',expected_version:analysis.version});
  if(analysis.review_state==='review')analysis=await call(`/api/analysis-reviews/${analysis.id}`,{action:'approve',expected_version:analysis.version});
  const welfare=await call('/api/welfare-recommendations',{analysis_id:analysis.id,expected_analysis_version:analysis.version,confirmations:[{need:'meal_support',finding_index:0,evidence_index:0,confirmed:true}]});s.welfare=welfare;s.analysis=analysis;
 }
 const title='[합성 데모] 다음 주 식사 및 외출 상태 재확인';if(!(await call(`/api/follow-ups?person_id=${person_id}`)).some((r:any)=>r.title===title))await call('/api/follow-ups',{person_id,title,...ref(current)},201);
 const noticeTitle='[합성 데모] 상담 기록 검토 안내';if(!(await call('/api/notifications')).some((r:any)=>r.title===noticeTitle))await call('/api/notifications',{title:noticeTitle,body:'합성 상담 기록과 근거를 확인해 주세요. 실제 발송 알림이 아닙니다.'},201);
 // Login with actual patient credentials, confirm role and cross-person denial.
 await login(patient);assert.equal((await call('/api/persons')).length,1);await call(`/api/records?person_id=${person_id}`,undefined,200);await call(`/api/records?person_id=${accounts[3-i].person_id}`,undefined,403);await call('/api/records',{person_id,text:'forbidden'},403);
 await login(staff);await call(`/api/records?person_id=${accounts[3-i].person_id}`,undefined,403);
 summary.push({name:patient.name,user_id:patient.user_id,person_id,staff_user_id:staff.user_id,appointments:await call('/api/appointments'),record_versions:(await call(`/api/records?person_id=${person_id}`)).length,analysis_status:s.analysis_status,findings:s.analysis?.original?.findings,welfare_candidates:s.welfare?.candidates?.length??0,tasks:(await call(`/api/follow-ups?person_id=${person_id}`)).length,notifications:(await call('/api/notifications')).length});await save();
}
await writeFile('.runtime/demo-summary.json',JSON.stringify({base,synthetic_only:true,automated_review:true,accounts:accounts.map(({password,...safe}:any)=>safe),summary},null,2));console.log(JSON.stringify(summary,null,2));
