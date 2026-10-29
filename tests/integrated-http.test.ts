import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createIntegratedApp } from '../src/integrated-app.js';
describe('synthetic HTTP configuration and boundaries',()=>{
 it('requires explicit synthetic mode, rejects production and unsupported DB/provider',()=>{
  for(const env of [{},{CAREGAP_SYNTHETIC_HTTP:'1',NODE_ENV:'production'},{CAREGAP_SYNTHETIC_HTTP:'1',STORAGE_MODE:'postgres'},{CAREGAP_SYNTHETIC_HTTP:'1',ANALYSIS_PROVIDER:'llm'}]) expect(()=>createIntegratedApp(env)).toThrow();
 });
 it('rejects client-selected admin roles, unknown origins and anonymous records',async()=>{
  const app=createIntegratedApp({CAREGAP_SYNTHETIC_HTTP:'1',FE_ORIGINS:'https://team.example'});
  expect((await request(app).post('/api/auth/register').send({identifier:'synthetic',password:'synthetic-test-password',role:'admin'})).status).toBe(400);
  expect((await request(app).get('/health').set('Origin','https://outside.example')).status).toBe(403);
  const allowed=await request(app).options('/api/records').set('Origin','https://team.example');
  expect(allowed.status).toBe(204);expect(allowed.headers['access-control-allow-origin']).toBe('https://team.example');
  expect((await request(app).get('/api/records')).status).toBe(401);
 });
});
