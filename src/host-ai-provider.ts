import {TranscriptOutput} from './modules/be3-intelligence/stt/model.js';
export class HostAiProvider {
 constructor(private url:string,private token:string){if(!['http://host.docker.internal:4326','http://127.0.0.1:4326'].includes(url)||token.length<32)throw Error('INVALID_HOST_AI_CONFIG');}
 private async call(kind:string,input:Uint8Array,mimeType:string){const r=await fetch(`${this.url}/${kind}`,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({base64:Buffer.from(input).toString('base64'),mimeType}),signal:AbortSignal.timeout(100000)});if(!r.ok)throw Error('HOST_AI_FAILED');return await r.json() as any;}
 async extract(input:Uint8Array,mimeType:string){const v=await this.call('ocr',input,mimeType);if(typeof v.text!=='string')throw Error('HOST_AI_PROTOCOL');return v.text as string;}
 async transcribeSegments(input:Uint8Array,mimeType:string){return TranscriptOutput.parse(await this.call('stt',input,mimeType));}
 async transcribe(input:Uint8Array,mimeType:string){return (await this.transcribeSegments(input,mimeType)).text;}
}
