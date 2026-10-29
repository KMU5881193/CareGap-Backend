import {it,expect,vi,afterEach} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {createIntegratedApp} from '../src/integrated-app.js';
import {OllamaAnalysisProvider} from '../src/modules/be3-intelligence/ollama-provider.js';
afterEach(()=>vi.restoreAllMocks());
it('isolates final BE2 records/tasks/notifications, keeps revisions and expires sessions',async()=>{
 const app=createIntegratedApp({CAREGAP_SYNTHETIC_HTTP:'1'});
 async function user(){const c={identifier:randomUUID(),password:randomUUID()};await request(app).post('/api/auth/register').send(c).expect(201);return (await request(app).post('/api/auth/login').send(c)).body.data.access_token;}
 const a=await user(),b=await user();const person=(await request(app).post('/api/persons').auth(a,{type:'bearer'}).send({})).body.data.person_id;
 const record=(await request(app).post('/api/records').auth(a,{type:'bearer'}).send({person_id:person,text:'합성 기록'})).body.data;
 await request(app).get(`/api/records?person_id=${person}`).auth(b,{type:'bearer'}).expect(403);
 await request(app).post('/api/follow-ups').auth(b,{type:'bearer'}).send({person_id:person,title:'no'}).expect(403);
 await request(app).post(`/api/records/${record.consultation_id}/versions`).auth(a,{type:'bearer'}).send({expected_record_version_id:randomUUID(),text:'변경'}).expect(409);
 await request(app).post(`/api/records/${record.consultation_id}/versions`).auth(a,{type:'bearer'}).send({expected_record_version_id:record.record_version_id,text:'변경'}).expect(201);
 expect((await request(app).get(`/api/records?person_id=${person}`).auth(a,{type:'bearer'})).body.data).toHaveLength(2);
 const n=(await request(app).post('/api/notifications').auth(a,{type:'bearer'}).send({title:'합성',body:'확인'})).body.data;
 await request(app).post(`/api/notifications/${n.notification_id}/read`).auth(b,{type:'bearer'}).send({}).expect(404);
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+3600001);
 await request(app).get('/api/auth/me').auth(a,{type:'bearer'}).expect(401);
 expect((await request(createIntegratedApp({CAREGAP_SYNTHETIC_HTTP:'1'})).get('/api/auth/me').auth(b,{type:'bearer'})).status).toBe(401);
});
it('rejects fabricated source indices, contradictory numeric direction and unavailable Ollama without fallback',async()=>{
 const sources=[{consultation_id:randomUUID(),record_version_id:randomUUID(),text:'하루 3회 식사했습니다.'},{consultation_id:randomUUID(),record_version_id:randomUUID(),text:'하루 2회 식사했습니다.'}];
 const provider=new OllamaAnalysisProvider();
 const fake=(change:string,indices:number[])=>new Response(JSON.stringify({done:true,message:{content:JSON.stringify({findings:[{text:'합성',change,source_indices:indices}],questions:['확인할까요?','더 알려주실까요?']})}}));
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(fake('unchanged',[0,1])).mockResolvedValueOnce(fake('worsened',[0,99])).mockRejectedValueOnce(new Error('unavailable'));
 await expect(provider.generate(sources)).rejects.toThrow('INVALID_ANALYSIS');
 await expect(provider.generate(sources)).rejects.toThrow();
 await expect(provider.generate(sources)).rejects.toThrow('unavailable');
});
it('blocks missed medication described as unchanged or as complete cessation',async()=>{
 const sources=[{consultation_id:randomUUID(),record_version_id:randomUUID(),text:'매일 약을 복용했습니다.'},{consultation_id:randomUUID(),record_version_id:randomUUID(),text:'이틀 약을 복용하지 않았습니다.'}];
 const response=(text:string,change:string)=>new Response(JSON.stringify({done:true,message:{content:JSON.stringify({findings:[{text,change,source_indices:[0,1]}],questions:['확인할까요?','추가 확인이 필요한가요?']})}}));
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response('복약 상태 동일','unchanged')).mockResolvedValueOnce(response('복약 중단','worsened'));
 const provider=new OllamaAnalysisProvider();
 await expect(provider.generate(sources)).rejects.toThrow('INVALID_ANALYSIS');
 await expect(provider.generate(sources)).rejects.toThrow('INVALID_ANALYSIS');
});
