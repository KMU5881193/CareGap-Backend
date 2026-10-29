import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor, AuthorizationPort } from '../../shared/contracts.js';
import { OcrError, validateImage } from './ocr-image.js';

const Observation = z.object({
  text: z.string().min(1).max(500),
  evidence: z.string().min(1).max(500),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();
export const VisionResult = z.object({
  care_note: z.string().min(1).max(2000),
  observations: z.array(Observation).max(12),
  uncertainties: z.array(z.string().min(1).max(500)).max(12),
  safety_notice: z.string().min(1).max(500),
}).strict();
export type VisionResult = z.infer<typeof VisionResult>;

export interface VisionProvider {
  analyze(bytes: Uint8Array, mimeType: 'image/jpeg'|'image/png', signal: AbortSignal): Promise<{ result: VisionResult; model: string }>;
}

type Stored = { fingerprint:string; data:ReturnType<VisionService['publicResult']> };
export class VisionService {
  private requests = new Map<string, Stored>();
  constructor(private provider:VisionProvider, private authorization:AuthorizationPort, private timeoutMs=120_000) {}

  async create(actor:Actor, key:string, body:unknown) {
    if(actor.role !== 'staff') throw new OcrError('FORBIDDEN',403);
    const parsed=z.object({person_id:z.uuid(),filename:z.string(),mimeType:z.enum(['image/jpeg','image/png']),base64:z.string().min(4)}).strict().parse(body);
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.base64) || parsed.base64.length%4) throw new OcrError('INVALID_IMAGE');
    let allowed=false; try { allowed=await this.authorization.canAccess(actor,parsed.person_id,'analyze')===true; } catch {}
    if(!allowed) throw new OcrError('FORBIDDEN',403);
    const image=await validateImage({filename:parsed.filename,mimeType:parsed.mimeType,bytes:Buffer.from(parsed.base64,'base64')});
    const fingerprint=createHash('sha256').update(actor.user_id).update(parsed.person_id).update(image.mimeType).update(image.bytes).digest('hex');
    const scoped=`${actor.user_id}:vision:${key}`; const prior=this.requests.get(scoped);
    if(prior){if(prior.fingerprint!==fingerprint)throw new OcrError('IDEMPOTENCY_CONFLICT',409);return prior.data;}
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const output=await this.provider.analyze(image.bytes,image.mimeType,controller.signal);
      let stillAllowed=false; try { stillAllowed=await this.authorization.canAccess(actor,parsed.person_id,'analyze')===true; } catch {}
      if(!stillAllowed)throw new OcrError('FORBIDDEN',403);
      const data=this.publicResult(randomUUID(),parsed.person_id,output);
      this.requests.set(scoped,{fingerprint,data}); return data;
    } catch(error) {
      if(error instanceof OcrError)throw error;
      if(controller.signal.aborted)throw new OcrError('VISION_TIMEOUT',504);
      throw new OcrError('VISION_PROVIDER_UNAVAILABLE',503);
    } finally { clearTimeout(timer); }
  }
  publicResult(id:string,person_id:string,output:{result:VisionResult;model:string}) {
    return {id,person_id,status:'succeeded' as const,synthetic_only:true,stored_image:false,provider_kind:'llm' as const,
      provider_metadata:{provider:'ollama' as const,model:output.model,prompt_version:'caregap-direct-vision-v1'},
      provenance:{input_kind:'direct_multimodal_image' as const,ocr_used:false,human_review_required:true},result:VisionResult.parse(output.result)};
  }
}
