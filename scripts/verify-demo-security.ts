import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4334';const a=JSON.parse(await readFile('.runtime/demo-credentials.json','utf8'));const trace:any[]=[];
async function req(path:string,body:any,token:string,status:number){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const out=r.status===204?null:await r.json() as any;trace.push({path,expected:status,status:r.status,...(!path.endsWith('/login')?{response:out}:{})});assert.equal(r.status,status);return out?.data;}
const login=async(i:number)=>(await req('/api/auth/login',{identifier:a[i].identifier,password:a[i].password},'',200)).access_token;
await req('/api/persons',undefined,'',401);await req('/api/auth/login',{identifier:a[0].identifier,password:'intentionally-invalid-synthetic-password'},'',401);
const staff=await login(0),other=await login(1),patient=await login(2);
await req('/api/auth/register',{identifier:'forged-role-attempt',password:'invalid-synthetic-register-password',role:'admin'},'',400);
await req(`/api/records?person_id=${a[3].person_id}`,undefined,staff,403);
await req('/api/persons',{},patient,403);
await req('/api/appointments',{person_id:a[2].person_id,starts_at:'2026-11-02T01:00:00Z',ends_at:'2026-11-02T02:00:00Z'},patient,409);
const notices=await req('/api/notifications',undefined,staff,200);await req(`/api/notifications/${notices[0].notification_id}/read`,{},other,404);
await req('/api/auth/logout',{},patient,204);await req('/api/auth/me',undefined,patient,401);
await writeFile('.runtime/security-http.json',JSON.stringify({base,synthetic_only:true,trace},null,2));console.log('PASS actual HTTP authentication, assignment, conflict, notification and logout boundaries');
