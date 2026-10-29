import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaVisionProvider } from '../src/modules/be3-intelligence/ollama-vision-provider.js';

const result={care_note:'합성 장면',observations:[{text:'컵',evidence:'중앙의 컵',confidence:'high'}],uncertainties:[],safety_notice:'사람 검토 필요, 자동 승인·의료 판단 아님'};
afterEach(()=>vi.unstubAllGlobals());
describe('Ollama direct vision provider',()=>{
 it('uses the multimodal images field instead of OCR text',async()=>{const fetch=vi.fn(async(_url:string,init:RequestInit)=>new Response(JSON.stringify({done:true,model:'qwen2.5vl:7b',message:{content:JSON.stringify(result)}}),{status:200}));vi.stubGlobal('fetch',fetch);await new OllamaVisionProvider().analyze(Uint8Array.from([1,2,3]),'image/png',new AbortController().signal);const request=JSON.parse(String(fetch.mock.calls[0][1].body));expect(request.messages[1]).toMatchObject({role:'user',images:[Buffer.from([1,2,3]).toString('base64')]});expect(request.messages[1].content).not.toContain(Buffer.from([1,2,3]).toString('base64'));});
 it('retries one transient Ollama 5xx response',async()=>{const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({done:true,model:'qwen2.5vl:7b',message:{content:JSON.stringify(result)}}),{status:200}));vi.stubGlobal('fetch',fetch);await new OllamaVisionProvider().analyze(Uint8Array.from([1]),'image/png',new AbortController().signal);expect(fetch).toHaveBeenCalledTimes(2);});
});
