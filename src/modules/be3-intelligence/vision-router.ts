import express from 'express';
import { z, ZodError } from 'zod';
import { Actor } from '../../shared/contracts.js';
import { OcrError } from './ocr-image.js';
import type { VisionService } from './vision.js';

export function createVisionRouter(service:VisionService,resolveActor:(req:express.Request)=>Promise<unknown>){
  const router=express.Router();
  router.post('/analyses',async(req,res,next)=>{try{
    const actor=await resolveActor(req);if(!Actor.safeParse(actor).success)throw new OcrError('UNAUTHENTICATED',401);
    const key=req.get('Idempotency-Key');if(!key||!z.string().min(1).max(128).safeParse(key).success)throw new OcrError('INVALID_IDEMPOTENCY_KEY');
    res.status(201).json({data:await service.create(actor as Actor,key,req.body)});
  }catch(e){next(e);}});
  router.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const tooLarge=typeof error==='object'&&error!==null&&'type'in error&&(error as any).type==='entity.too.large';const status=error instanceof OcrError?error.status:tooLarge?413:error instanceof ZodError?400:500;const code=error instanceof OcrError?error.code:tooLarge?'IMAGE_TOO_LARGE':status===400?'INVALID_REQUEST':'INTERNAL_ERROR';res.status(status).json({error:{code}});});
  return router;
}
