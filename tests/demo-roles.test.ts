import {it,expect} from 'vitest';
import request from 'supertest';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIntegratedApp} from '../src/integrated-app.js';
it('authenticates four bootstrap actors and enforces assigned staff / own patient access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'caregap-roles-'));
 const rows=Array.from({length:4},(_,i)=>({identifier:randomUUID(),password:randomBytes(24).toString('hex'),name:`합성 ${i}`,role:i<2?'staff':'patient',user_id:randomUUID(),...(i>=2?{person_id:randomUUID(),staff_user_id:''}:{})}));
 rows[2].staff_user_id=rows[0].user_id;rows[3].staff_user_id=rows[1].user_id;
 const file=join(dir,'accounts.json');writeFileSync(file,JSON.stringify(rows));
 try {
 const app=createIntegratedApp({CAREGAP_SYNTHETIC_HTTP:'1',CAREGAP_DEMO_ACCOUNTS_FILE:file});
 const tokens=[];for(const row of rows){const r=await request(app).post('/api/auth/login').send({identifier:row.identifier,password:row.password}).expect(200);expect(r.body.data.actor.role).toBe(row.role);tokens.push(r.body.data.access_token);}
 for(let i=0;i<4;i++){const p=rows[i%2+2];const other=rows[(i+1)%2+2];
  const people=await request(app).get('/api/persons').auth(tokens[i],{type:'bearer'}).expect(200);expect(people.body.data.map((p:any)=>p.person_id)).toEqual([p.person_id]);
  await request(app).get(`/api/records?person_id=${p.person_id}`).auth(tokens[i],{type:'bearer'}).expect(200);
  await request(app).get(`/api/records?person_id=${other.person_id}`).auth(tokens[i],{type:'bearer'}).expect(403);
  await request(app).post('/api/appointments').auth(tokens[i],{type:'bearer'}).send({person_id:other.person_id,starts_at:'2026-11-02T01:00:00Z',ends_at:'2026-11-02T02:00:00Z'}).expect(403);
 }
 const booked=await request(app).post('/api/appointments').auth(tokens[2],{type:'bearer'}).send({person_id:rows[2].person_id,starts_at:'2026-11-02T01:00:00Z',ends_at:'2026-11-02T02:00:00Z'}).expect(201);expect(booked.body.data.staff_user_id).toBe(rows[0].user_id);
 expect((await request(app).get('/api/appointments').auth(tokens[0],{type:'bearer'})).body.data).toHaveLength(1);
 expect((await request(app).get('/api/appointments').auth(tokens[3],{type:'bearer'})).body.data).toHaveLength(0);
 for(const path of ['/api/persons','/api/records','/api/records/import','/api/analyses','/api/analysis-reviews/'+randomUUID(),'/api/vision/analyses','/api/ocr/jobs','/api/stt/jobs','/api/follow-ups','/api/notifications',`/api/appointments/${booked.body.data.appointment_id}/actions`])await request(app).post(path).auth(tokens[2],{type:'bearer'}).send({}).expect(403);
 await request(app).post('/api/auth/register').send({identifier:'forged',password:randomUUID(),role:'admin'}).expect(400);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
