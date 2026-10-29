import express from 'express';
import { Actor } from './shared/contracts.js';
import type { parseConfig } from './config.js';
export function createApp(config:ReturnType<typeof parseConfig>) {
 if(config.NODE_ENV==='production' && config.DEV_AUTH_ENABLED==='true') throw new Error('Development authentication is forbidden in production');
 const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'256kb'}));
 app.get('/health',(_req,res)=>res.json({data:{status:'ok'}}));
 // Legacy BE1 routes store plaintext demo passwords and do not enforce a trusted
 // session, administrator role, or subject relationship. Keep every route closed
 // until a verified Supabase JWT + database authorization adapter is injected.
 app.use(['/api/auth', '/api/relationships', '/api/consultations', '/api/welfare'], (_req,res)=>res.status(503).json({error:{code:'AUTHORIZATION_NOT_CONFIGURED',message:'Protected integration adapter required'}}));
 app.get('/api/dev/actor',(req,res)=>{
  if(config.NODE_ENV==='production' || config.DEV_AUTH_ENABLED!=='true') return res.status(404).json({error:{code:'NOT_FOUND',message:'Not found'}});
  const raw=req.get('X-Test-Actor');
  try { const actor=Actor.parse(JSON.parse(raw ?? 'null')); return res.json({data:actor}); }
  catch {return res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Valid test actor required'}});}
 });
 app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Not found'}}));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const bad=error instanceof SyntaxError;
  res.status(bad?400:500).json({error:{code:bad?'INVALID_REQUEST':'INTERNAL_ERROR',message:bad?'Invalid JSON request':'Internal error'}});
 });
 return app;
}
