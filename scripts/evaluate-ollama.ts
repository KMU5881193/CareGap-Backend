import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {OllamaAnalysisProvider} from '../src/modules/be3-intelligence/ollama-provider.js';
const cases=JSON.parse(await readFile('scripts/ollama-evaluation.json','utf8'));
const p=new OllamaAnalysisProvider(process.env.OLLAMA_MODEL ?? 'qwen2.5vl:7b');
for(const c of cases){const started=Date.now();try{const draft=await p.generate([c.past,c.current].map(text=>({consultation_id:randomUUID(),record_version_id:randomUUID(),text})));console.log(JSON.stringify({case:c.id,input:{past:c.past,current:c.current},expected:c.expected,actual:draft.findings,pass:draft.findings.length===1&&draft.findings[0].change===c.expected,elapsed_ms:Date.now()-started}));}catch(e){console.log(JSON.stringify({case:c.id,pass:false,error:String(e)}));}}
