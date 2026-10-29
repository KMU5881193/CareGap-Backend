import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../src/shared/contracts.js';
import { createVisionRouter } from '../src/modules/be3-intelligence/vision-router.js';
import { VisionService, type VisionProvider } from '../src/modules/be3-intelligence/vision.js';

const actor:Actor={user_id:'00000000-0000-4000-8000-000000000001',role:'staff'};
const person='00000000-0000-4000-8000-000000000002';
const result={care_note:'탁자 위에 물컵이 보입니다.',observations:[{text:'물컵이 있습니다.',evidence:'이미지 중앙의 투명한 컵',confidence:'high' as const}],uncertainties:['촬영 시각은 알 수 없습니다.'],safety_notice:'사람 검토가 필요하며 자동 승인이나 의료 판단이 아닙니다.'};

async function setup(overrides:{actor?:Actor|null;allowed?:boolean;provider?:VisionProvider}={}){
 const png=await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer();
 const analyze=vi.fn(async(_bytes:Uint8Array,_mime:'image/jpeg'|'image/png',_signal:AbortSignal)=>({result,model:'qwen2.5vl:7b'}));const provider=overrides.provider??{analyze};
 const service=new VisionService(provider,{canAccess:async()=>overrides.allowed??true},50);
 const app=express();app.use(express.json({limit:'7mb'}));app.use('/api/vision',createVisionRouter(service,async()=>overrides.actor===undefined?actor:overrides.actor));
 return {app,analyze,payload:{person_id:person,filename:'synthetic.png',mimeType:'image/png',base64:png.toString('base64')}};
}

describe('direct multimodal vision API',()=>{
 it('passes decoded image to the provider and returns evidence/provenance without retaining image',async()=>{const s=await setup();const response=await request(s.app).post('/api/vision/analyses').set('Idempotency-Key','vision-1').send(s.payload);expect(response.status).toBe(201);expect(s.analyze).toHaveBeenCalledOnce();expect(s.analyze.mock.calls[0][0]).toBeInstanceOf(Uint8Array);expect(response.body.data).toMatchObject({synthetic_only:true,stored_image:false,provider_kind:'llm',provenance:{input_kind:'direct_multimodal_image',ocr_used:false,human_review_required:true},result});expect(JSON.stringify(response.body)).not.toContain(s.payload.base64);});
 it('replays the same idempotent request and rejects a changed payload',async()=>{const s=await setup();const first=await request(s.app).post('/api/vision/analyses').set('Idempotency-Key','same').send(s.payload);const replay=await request(s.app).post('/api/vision/analyses').set('Idempotency-Key','same').send(s.payload);expect(replay.body).toEqual(first.body);expect(s.analyze).toHaveBeenCalledOnce();const conflict=await request(s.app).post('/api/vision/analyses').set('Idempotency-Key','same').send({...s.payload,person_id:'00000000-0000-4000-8000-000000000003'});expect(conflict.status).toBe(409);});
 it('requires auth, staff role, ownership and an idempotency key',async()=>{expect((await request((await setup({actor:null})).app).post('/api/vision/analyses').set('Idempotency-Key','k').send((await setup()).payload)).status).toBe(401);const family={...actor,role:'family' as const};const sf=await setup({actor:family});expect((await request(sf.app).post('/api/vision/analyses').set('Idempotency-Key','k').send(sf.payload)).status).toBe(403);const denied=await setup({allowed:false});expect((await request(denied.app).post('/api/vision/analyses').set('Idempotency-Key','k').send(denied.payload)).status).toBe(403);const missing=await setup();expect((await request(missing.app).post('/api/vision/analyses').send(missing.payload)).status).toBe(400);});
 it('rejects MIME mismatch and maps timeout without leaking provider errors',async()=>{const bad=await setup();expect((await request(bad.app).post('/api/vision/analyses').set('Idempotency-Key','bad').send({...bad.payload,mimeType:'image/jpeg',filename:'synthetic.jpg'})).body.error.code).toBe('MIME_MISMATCH');const hanging:VisionProvider={analyze:(_b,_m,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private provider detail'))))};const timed=await setup({provider:hanging});const response=await request(timed.app).post('/api/vision/analyses').set('Idempotency-Key','timeout').send(timed.payload);expect(response.status).toBe(504);expect(response.body).toEqual({error:{code:'VISION_TIMEOUT'}});});
});
