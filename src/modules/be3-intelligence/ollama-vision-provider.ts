import { z } from 'zod';
import { VisionResult, type VisionProvider } from './vision.js';

export class OllamaVisionProvider implements VisionProvider {
  constructor(private model='qwen2.5vl:7b',private base='http://127.0.0.1:11434'){
    if(!['http://127.0.0.1:11434','http://host.docker.internal:11434'].includes(base))throw Error('INVALID_LOCAL_OLLAMA_URL');
  }
  async analyze(bytes:Uint8Array,_mimeType:'image/jpeg'|'image/png',signal:AbortSignal){
    const body={model:this.model,stream:false,keep_alive:'15m',format:z.toJSONSchema(VisionResult),options:{temperature:0,num_ctx:4096,num_predict:900},messages:[
      {role:'system',content:'이 이미지는 합성 데모 자료다. 이미지 자체를 직접 관찰해 한국어 돌봄 메모를 작성하라. 보이는 사실만 기술하고 각 관찰에 구체적인 시각 근거를 적어라. 사람의 신원, 관계, 나이, 성별, 질병, 장애, 감정, 위험도, 복지 자격을 추측하거나 진단하지 마라. 글자가 불명확하면 읽었다고 꾸미지 말고 uncertainties에 적어라. care_note는 중립적이어야 한다. safety_notice에는 사람 검토가 필요하고 자동 승인·의료 판단이 아님을 명시하라.'},
      {role:'user',content:'이미지를 직접 분석해 지정된 JSON 형식으로 답하세요.',images:[Buffer.from(bytes).toString('base64')]}
    ]};
    let last:unknown;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch(this.base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
        if(!response.ok){if(response.status>=500&&attempt===0)continue;throw Error('OLLAMA_HTTP_ERROR');}
        const raw=await response.json() as any;if(!raw.done)throw Error('OLLAMA_INCOMPLETE');
        return {result:VisionResult.parse(JSON.parse(raw.message.content)),model:String(raw.model||this.model)};
      }catch(error){last=error;if(signal.aborted||attempt===1)throw error;}
    }
    throw last;
  }
}
