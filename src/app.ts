import express from 'express';
import { Actor } from './shared/contracts.js';
import type { parseConfig } from './config.js';
import { createAuthRouter } from './modules/be1-auth/auth.routes.js';//be1 추가
import { createRelationshipRouter } from './modules/be1-auth/relationship.routes.js';//be1 추가
import { createConsultationRouter } from './modules/consultations/consultation.routes.js';//be1 supabase 추가
import { createWelfareRouter } from './modules/welfare/welfare.routes.js';//be1 supabse 추가
export function createApp(config:ReturnType<typeof parseConfig>) {
 if(config.NODE_ENV==='production' && config.DEV_AUTH_ENABLED==='true') throw new Error('Development authentication is forbidden in production');
 const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'256kb'}));
 app.get('/health',(_req,res)=>res.json({data:{status:'ok'}}));
 // These legacy routes lack session and subject authorization. Fail closed on every interface.
 app.use(['/api/auth/staff', '/api/relationships', '/api/consultations', '/api/welfare'], (_req,res)=>res.status(503).json({error:{code:'AUTHORIZATION_NOT_CONFIGURED',message:'Protected integration adapter required'}}));
 app.use('/api/auth', createAuthRouter());//be1 추가
 app.use('/api/relationships', createRelationshipRouter());//be1 추가
 app.use('/api/consultations', createConsultationRouter());//be1 추가
 app.use('/api/welfare', createWelfareRouter());//be1 추가
 app.get('/api/dev/actor',(req,res)=>{
  if(config.NODE_ENV==='production' || config.DEV_AUTH_ENABLED!=='true') return res.status(404).json({error:{code:'NOT_FOUND',message:'Not found'}});
  const raw=req.get('X-Test-Actor');
  try { const actor=Actor.parse(JSON.parse(raw ?? 'null')); return res.json({data:actor}); }
  catch {return res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Valid test actor required'}});}
 });
 app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Not found'}}));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const bad=error instanceof SyntaxError;
  const message = error instanceof Error ? error.message : 'Internal error';
  res.status(bad?400:500).json({error:{code:bad?'INVALID_REQUEST':'INTERNAL_ERROR',message}});
 });//be1 수정
 return app;
}
