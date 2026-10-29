import { HostAiProvider } from './host-ai-provider.js';
import { mountFinalBe2 } from './final-be2.js';
import express from 'express';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { Actor, RecordVersion } from './shared/contracts.js';
import { AppointmentCreateInput } from './modules/be2-consultations/api-schema.js';
import { findAppointmentConflicts } from './modules/be2-consultations/appointment-conflict.js';
import { ConsultationRecordVersion } from './modules/be2-consultations/consultation-record.js';
import { OcrService, InMemoryOcrRepository, MockOcrProvider } from './modules/be3-intelligence/ocr.js';
import { TranscriptService, InMemoryTranscriptRepository, MockSttProvider } from './modules/be3-intelligence/stt/service.js';
import { PythonOcrProvider } from './modules/be3-intelligence/python-ocr-provider.js';
import { LocalWhisperProvider } from './modules/be3-intelligence/stt/local-provider.js';
import { createOcrRouter } from './modules/be3-intelligence/ocr-router.js';
import { createTranscriptRouter } from './modules/be3-intelligence/stt/router.js';
import { AnalysisWorkflow } from './modules/be3-intelligence/analysis-workflow.js';
import { SyntheticAnalysisProvider } from './modules/be3-intelligence/analysis-mock.js';
import { OllamaAnalysisProvider } from './modules/be3-intelligence/ollama-provider.js';
import { createAnalysisRouter } from './modules/be3-intelligence/analysis-router.js';
import { WelfareRecommendationService } from './modules/be3-intelligence/welfare-service.js';
import { syntheticWelfareCatalog } from './modules/be3-intelligence/welfare-catalog.js';
import { AnalysisWelfareBridge } from './modules/be3-intelligence/analysis-welfare-bridge.js';
import { VisionService } from './modules/be3-intelligence/vision.js';
import { OllamaVisionProvider } from './modules/be3-intelligence/ollama-vision-provider.js';
import { createVisionRouter } from './modules/be3-intelligence/vision-router.js';

const fail = (status:number, code:string):never => { throw Object.assign(new Error(code), {status,code}); };
const credentials = z.object({identifier:z.string().min(3).max(80),password:z.string().min(12).max(128)}).strict();
// Explicit development adapter: no database credentials, seed accounts or automatic admin role.
export function createIntegratedApp(env:NodeJS.ProcessEnv) {
 if(env.CAREGAP_SYNTHETIC_HTTP !== '1' || env.NODE_ENV === 'production') throw new Error('SYNTHETIC_HTTP_OPT_IN_REQUIRED');
 if(env.STORAGE_MODE && env.STORAGE_MODE !== 'memory') throw new Error('DB_ADAPTER_NOT_IMPLEMENTED');
 if(env.ANALYSIS_PROVIDER && !['mock','ollama'].includes(env.ANALYSIS_PROVIDER)) throw new Error('ANALYSIS_PROVIDER_NOT_CONFIGURED');
 if(!['mock','python','host'].includes(env.OCR_PROVIDER ?? 'mock') || !['mock','local','host'].includes(env.STT_PROVIDER ?? 'mock')) throw new Error('INVALID_PROVIDER');
 const users = new Map<string,{actor:Actor;salt:Buffer;hash:Buffer}>();
 const sessions = new Map<string,{actor:Actor;expires:number}>();
 const persons = new Map<string,string>();
 const profiles = new Map<string,{name:string;patient_user_id:string;staff_user_id:string}>();
 // Trusted local bootstrap only. Public registration never accepts a role or assignment.
 if(env.CAREGAP_DEMO_ACCOUNTS_FILE){
  const rows=z.array(z.object({identifier:z.string().min(3).max(80),password:z.string().min(12).max(128),user_id:z.uuid(),role:z.enum(['staff','patient']),name:z.string().min(1),person_id:z.uuid().optional(),staff_user_id:z.uuid().optional()}).strict()).length(4).parse(JSON.parse(readFileSync(env.CAREGAP_DEMO_ACCOUNTS_FILE,'utf8')));
  if(new Set(rows.map(r=>r.identifier)).size!==4 || new Set(rows.map(r=>r.user_id)).size!==4 || rows.filter(r=>r.role==='staff').length!==2)throw Error('INVALID_DEMO_ASSIGNMENTS');
  for(const row of rows){const salt=randomBytes(16);users.set(row.identifier,{actor:{user_id:row.user_id,role:row.role},salt,hash:scryptSync(row.password,salt,32)});}
  for(const row of rows.filter(r=>r.role==='patient')){
   if(!row.person_id||!row.staff_user_id||!rows.some(s=>s.role==='staff'&&s.user_id===row.staff_user_id)||profiles.has(row.person_id))throw Error('INVALID_DEMO_ASSIGNMENTS');
   persons.set(row.person_id,row.staff_user_id);profiles.set(row.person_id,{name:row.name,patient_user_id:row.user_id,staff_user_id:row.staff_user_id});
  }
 }
 const records = new Map<string,RecordVersion>();
 const appointments = new Map<string,z.infer<typeof AppointmentCreateInput> & {appointment_id:string;staff_user_id:string;status:string}>();
 const app=express(); app.disable('x-powered-by');
 const origins=(env.FE_ORIGINS ?? '').split(',').filter(Boolean);
 app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  const origin=req.get('origin');
  if(origin && !origins.includes(origin)) return res.status(403).json({error:{code:'ORIGIN_REJECTED'}});
  if(origin){res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');res.set('Access-Control-Allow-Headers','Authorization, Content-Type, Idempotency-Key');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
 });
 app.use(express.json({limit:'14mb'}));
 const metadata={synthetic_only:true,storage:'memory_non_durable',providers:{ocr:env.OCR_PROVIDER ?? 'mock',stt:env.STT_PROVIDER ?? 'mock',analysis:env.ANALYSIS_PROVIDER ?? 'mock',welfare:'synthetic_unverified'}};
  app.get('/health',async(_req,res)=>{
  let available=false;let loaded=false;
  if(env.ANALYSIS_PROVIDER==='ollama')try{const r=await fetch((env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')+'/api/tags',{signal:AbortSignal.timeout(2000)});const body=await r.json() as any;available=r.ok&&body.models?.some((m:any)=>m.name===(env.OLLAMA_MODEL ?? 'qwen2.5vl:7b'));const ps=await fetch((env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')+'/api/ps',{signal:AbortSignal.timeout(2000)});loaded=(await ps.json() as any).models?.some((m:any)=>m.name===(env.OLLAMA_MODEL ?? 'qwen2.5vl:7b'))??false;}catch{}
  res.json({data:{status:'ok',...metadata,release:env.CAREGAP_RELEASE ?? 'development',models:{analysis:env.ANALYSIS_PROVIDER==='ollama'?env.OLLAMA_MODEL ?? 'qwen2.5vl:7b':null,ollama_model_available:available,ollama_model_loaded:loaded,ocr:['python','host'].includes(env.OCR_PROVIDER ?? '')?'handwriting-line-onnx-cpu':null,stt:['local','host'].includes(env.STT_PROVIDER ?? '')?'faster-whisper-base-cpu-int8':null},readiness_note:'Availability is not inference verification; see validated E2E results.'}});
 });
 const attempts=new Map<string,{count:number;until:number}>();
 app.use('/api/auth',(req,res,next)=>{const key=req.socket.remoteAddress ?? 'unknown';const now=Date.now();let entry=attempts.get(key);if(!entry || entry.until<now){entry={count:0,until:now+60000};attempts.set(key,entry);}if(++entry.count>30)return res.status(429).json({error:{code:'RATE_LIMITED'}});next();});
 app.post('/api/auth/register',(req,res)=>{
  const body=credentials.parse(req.body);if(users.has(body.identifier))fail(409,'IDENTIFIER_EXISTS');if(users.size>=100)fail(429,'DEMO_CAPACITY');
  const salt=randomBytes(16);const actor:Actor={user_id:randomUUID(),role:'staff'};
  users.set(body.identifier,{actor,salt,hash:scryptSync(body.password,salt,32)});
  res.status(201).json({data:{...actor,synthetic_only:true}});
 });
 const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
 app.post('/api/auth/login',(req,res)=>{const body=credentials.parse(req.body);const user=users.get(body.identifier);const hash=scryptSync(body.password,user?.salt ?? Buffer.alloc(16),32);if(!user || !timingSafeEqual(hash,user.hash))return fail(401,'UNAUTHENTICATED');const token=randomBytes(32).toString('base64url');sessions.set(digest(token),{actor:user.actor,expires:Date.now()+3600000});res.json({data:{access_token:token,token_type:'Bearer',expires_in:3600,actor:user.actor,...metadata}});});
 const authenticate=async(req:express.Request)=>{const raw=req.get('authorization');if(!raw?.startsWith('Bearer '))return fail(401,'UNAUTHENTICATED');const key=digest(raw.slice(7));const session=sessions.get(key);if(!session || session.expires<=Date.now()){sessions.delete(key);return fail(401,'UNAUTHENTICATED');}return session.actor;};
 app.use('/api',async(req,res,next)=>{try{res.locals.actor=await authenticate(req);next();}catch(e){next(e);}});
 app.post('/api/auth/logout',(req,res)=>{sessions.delete(digest(req.get('authorization')!.slice(7)));res.sendStatus(204);});
 app.get('/api/auth/me',(_req,res)=>res.json({data:res.locals.actor}));
 app.use('/api/auth/staff',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND'}}));
 // Patients can see their own records and book their own appointment, but cannot
 // write clinical records, run models, approve findings or create staff tasks.
 app.use('/api',(req,res,next)=>{
  if(res.locals.actor.role==='patient' && req.method!=='GET' && !['/appointments','/auth/logout'].includes(req.path) && !/^\/notifications\/[^/]+\/read$/.test(req.path))return res.status(403).json({error:{code:'FORBIDDEN'}});
  next();
 });
 const authorization={async canAccess(actor:Actor,person:string){return persons.get(person)===actor.user_id;}};
 const actor=(res:express.Response)=>res.locals.actor as Actor;
 const canRead=(a:Actor,id:string)=>a.role==='staff'?persons.get(id)===a.user_id:a.role==='patient'&&profiles.get(id)?.patient_user_id===a.user_id;
 const access=(res:express.Response,id:string)=>{if(!canRead(actor(res),id))fail(403,'FORBIDDEN');};
 app.post('/api/persons',(_req,res)=>{if(persons.size>=1000)fail(429,'DEMO_CAPACITY');const person_id=randomUUID();persons.set(person_id,actor(res).user_id);res.status(201).json({data:{person_id,synthetic_only:true}});});
 app.get('/api/persons',(_req,res)=>res.json({data:[...persons.keys()].filter(id=>canRead(actor(res),id)).map(person_id=>({person_id,...profiles.get(person_id),synthetic_only:true}))}));
 app.post('/api/appointments',(req,res)=>{const b=AppointmentCreateInput.parse(req.body);access(res,b.person_id);const candidate={...b,staff_user_id:persons.get(b.person_id)!};const conflicts=findAppointmentConflicts(candidate,[...appointments.values()],{occupyingStatuses:['scheduled'],blockingRelations:['overlaps','overlapped-by','starts','started-by','during','contains','finishes','finished-by','equal']});if(!conflicts.configured || conflicts.conflicts.length)fail(409,'APPOINTMENT_CONFLICT');const data={...candidate,appointment_id:randomUUID(),status:'scheduled'};appointments.set(data.appointment_id,data);res.status(201).json({data});});
 app.get('/api/appointments',(_req,res)=>res.json({data:[...appointments.values()].filter(a=>canRead(actor(res),a.person_id))}));
 const save=(person_id:string,text:string)=>{const data=ConsultationRecordVersion.parse({person_id,text,consultation_id:randomUUID(),record_version_id:randomUUID()});records.set(data.record_version_id,data);return data;};
 app.post('/api/records',(req,res)=>{const b=z.object({person_id:z.uuid(),text:z.string().min(1).max(100000)}).strict().parse(req.body);access(res,b.person_id);res.status(201).json({data:save(b.person_id,b.text)});});
 app.get('/api/records',(req,res)=>{const id=z.uuid().parse(req.query.person_id);access(res,id);res.json({data:[...records.values()].filter(r=>r.person_id===id)});});
 mountFinalBe2(app,records,appointments,access);
 const hostAi=(env.OCR_PROVIDER==='host'||env.STT_PROVIDER==='host')?new HostAiProvider(env.HOST_AI_URL ?? '',env.HOST_AI_TOKEN ?? ''):null;
 const ocr=new OcrService(new InMemoryOcrRepository(),env.OCR_PROVIDER==='host'?hostAi!:env.OCR_PROVIDER==='python'?new PythonOcrProvider({pythonPath:env.OCR_PYTHON_PATH ?? '',engine:z.enum(['tesseract','paddle','handwriting-line']).parse(env.OCR_ENGINE ?? 'tesseract'),workerPath:env.OCR_WORKER_PATH}):new MockOcrProvider(),authorization,undefined,env.OCR_PROVIDER!=='mock'?105000:5000);
 const stt=new TranscriptService(new InMemoryTranscriptRepository(),env.STT_PROVIDER==='host'?hostAi!:env.STT_PROVIDER==='local'?new LocalWhisperProvider({pythonPath:env.STT_PYTHON_PATH ?? '',modelPath:env.STT_MODEL_PATH ?? ''}):new MockSttProvider(),authorization,env.STT_PROVIDER!=='mock'?105000:10000);
 app.use('/api/ocr',createOcrRouter(ocr,authenticate));
 app.use('/api/stt',createTranscriptRouter(stt,authenticate));
 const imports=new Map<string,RecordVersion>();
 app.post('/api/records/import',(async(req,res)=>{const b=z.object({source:z.enum(['ocr','stt']),job_id:z.uuid()}).strict().parse(req.body);const input=b.source==='ocr'?await ocr.confirmedInput(actor(res),b.job_id):await stt.confirmedInput(actor(res),b.job_id);access(res,input.person_id);const key=`${actor(res).user_id}:${b.source}:${b.job_id}`;let data=imports.get(key);if(!data){data=save(input.person_id,input.text);imports.set(key,data);}res.status(201).json({data});}));
 const live=env.ANALYSIS_PROVIDER==='ollama'?new OllamaAnalysisProvider(env.OLLAMA_MODEL ?? 'qwen2.5vl:7b',env.OLLAMA_BASE_URL):null;
 if(live){const vision=new VisionService(new OllamaVisionProvider(env.OLLAMA_MODEL ?? 'qwen2.5vl:7b',env.OLLAMA_BASE_URL),authorization);app.use('/api/vision',createVisionRouter(vision,authenticate));}
 const workflow=new AnalysisWorkflow({authorization,provider:live ?? new SyntheticAnalysisProvider(),provider_kind:live?'llm':'mock',...(live?{provider_metadata:{provider:'ollama' as const,model:env.OLLAMA_MODEL ?? 'qwen2.5vl:7b',prompt_version:'caregap-temporal-v2'}}:{}),records:{async getVersion(c,v){const r=records.get(v);return r?.consultation_id===c?r:null;}}});
 const welfare=new WelfareRecommendationService({authorization,catalog:syntheticWelfareCatalog()});
 const bridge=new AnalysisWelfareBridge(workflow,welfare);
 app.post('/api/welfare-recommendations',async(req,res)=>res.json(await bridge.recommend(actor(res),req.body)));
 app.use(createAnalysisRouter(workflow,authenticate));
 app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND'}}));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const e=error as {status?:number;code?:string;type?:string};const status=error instanceof ZodError||error instanceof SyntaxError?400:e.status ?? 500;res.status(status).json({error:{code:status===500?'INTERNAL_ERROR':e.code ?? 'INVALID_REQUEST'}});});
 return app;
}
