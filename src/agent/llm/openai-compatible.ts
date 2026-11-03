import { setTimeout as sleep } from 'node:timers/promises';
import type { AppEnv } from '../../server/env';
import { LlmError,type LlmAdapter,type LlmRequest,type LlmResult } from './adapter';
interface Options {fetch?:typeof fetch;supportsSeed?:boolean;delay?:(ms:number,signal:AbortSignal)=>Promise<void>}
/** Clone before provider-only normalization; downstream schemas remain authoritative. */
function transportSchema(value:unknown):any {
  if(Array.isArray(value))return value.map(transportSchema);
  if(value===null||typeof value!=='object')return value;
  const result:Record<string,unknown>={};
  for(const [key,child] of Object.entries(value)){
    if(key==='$schema')continue;
    result[key==='oneOf'?'anyOf':key==='const'?'enum':key]=key==='const'?[structuredClone(child)]:transportSchema(child);
  }
  return result;
}
/** Retries share one overall timeout and keep upstream error bodies private. */
export class OpenAICompatibleAdapter implements LlmAdapter {
  readonly mode='openai-compatible' as const;
  readonly model:string;
  private endpoint:string;
  private groqEndpoint:boolean;
  constructor(private config:AppEnv['llm'],private options:Options={}) {
    if(!config.model||!config.baseUrl)throw new LlmError('llm_configuration');
    let url:URL;try{url=new URL(config.baseUrl);}catch{throw new LlmError('llm_configuration');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new LlmError('llm_configuration');
    this.endpoint=url.toString().replace(/\/$/,'')+'/chat/completions';this.model=config.model;
    const endpoint=new URL(this.endpoint);
    this.groqEndpoint=endpoint.origin==='https://api.groq.com'&&endpoint.pathname==='/openai/v1/chat/completions';
  }
  async health(){return null;}
  async complete(request:LlmRequest):Promise<LlmResult> {
    request.signal.throwIfAborted();const started=performance.now();
    const timeout=AbortSignal.timeout(this.config.timeoutMs),signal=AbortSignal.any([request.signal,timeout]);
    const headers:Record<string,string>={'content-type':'application/json',accept:'application/json'};
    if(this.config.apiKey)headers.authorization=`Bearer ${this.config.apiKey}`;
    const schema=transportSchema(request.jsonSchema),wrapped=schema.type!=='object';
    const providerSchema=wrapped?{type:'object',properties:{result:schema},required:['result'],additionalProperties:false}:schema;
    const body={model:this.model,messages:[{role:'system',content:request.system},{role:'user',content:request.user}],temperature:0,
      ...(this.options.supportsSeed===false||this.config.supportsSeed===false?{}:{seed:42}),max_tokens:request.maxTokens,
      ...(this.config.reasoningEffort?{reasoning_effort:this.config.reasoningEffort}:{}),
      response_format:{type:'json_schema',json_schema:{name:request.schemaName,strict:true,schema:providerSchema}},
      ...(this.config.llamaCpp?{chat_template_kwargs:{enable_thinking:false}}:{})};
    const serializedBody=JSON.stringify(body);
    try {
      let response:Response;
      let validationRetried=false;
      for(let attempt=0;;attempt++){
        signal.throwIfAborted();
        response=await (this.options.fetch??fetch)(this.endpoint,{method:'POST',headers,body:serializedBody,signal,redirect:'error'});
        if(!response.ok){
          let retryValidation=false;
          if(!validationRetried&&attempt<2&&response.status===400&&this.groqEndpoint&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){
            const reader=response.body?.getReader();
            if(reader){
              const cancel=()=>{void reader.cancel().catch(()=>{});};
              signal.addEventListener('abort',cancel,{once:true});
              try{
                const chunks:Uint8Array[]=[];let length=0;
                while(true){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();if(next.done)break;length+=next.value.byteLength;if(length>131072)break;chunks.push(next.value);}
                if(length<=131072)retryValidation=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.error?.code==='json_validate_failed';
              }catch{signal.throwIfAborted();}
              finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
            }else await response.body?.cancel();
          }else await response.body?.cancel();
          signal.throwIfAborted();
          if(retryValidation){validationRetried=true;continue;}
          const rateLimited=this.groqEndpoint&&response.status===429;
          if(![429,503].includes(response.status)||attempt>=2)throw new LlmError(rateLimited?'llm_rate_limited':'llm_upstream');
          const retryAfter=response.headers.get('retry-after')?.trim();
          const numeric=retryAfter&&/^\d+(?:\.\d+)?$/.test(retryAfter);
          const seconds=numeric?(rateLimited?Number(retryAfter):Math.min(Number(retryAfter),10)):attempt===0?1:3;
          if(rateLimited&&numeric&&seconds*1000+1000>this.config.timeoutMs-(performance.now()-started))throw new LlmError('llm_rate_limited');
          await (this.options.delay??((ms,abort)=>sleep(ms,undefined,{signal:abort})))(seconds*1000,signal);
          signal.throwIfAborted();continue;
        }
        if(signal.aborted){await response.body?.cancel();signal.throwIfAborted();}
        break;
      }
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new LlmError('llm_malformed');}
      const reader=response.body?.getReader();if(!reader)throw new LlmError('llm_malformed');
      const chunks:Uint8Array[]=[];let length=0;
      try{while(true){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();if(next.done)break;length+=next.value.byteLength;if(length>1048576)throw new LlmError('llm_response_too_large');chunks.push(next.value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const raw=Buffer.concat(chunks).toString('utf8');
      if(this.config.apiKey&&(raw.includes(this.config.apiKey)||raw.includes(JSON.stringify(this.config.apiKey).slice(1,-1))))throw new LlmError('llm_credential_reflection');
      let parsed:any;try{parsed=JSON.parse(raw);}catch{throw new LlmError('llm_malformed');}
      if(this.config.apiKey&&JSON.stringify(parsed).includes(this.config.apiKey))throw new LlmError('llm_credential_reflection');
      const choice=parsed?.choices?.[0],message=choice?.message;
      if(typeof message?.refusal==='string'&&message.refusal)throw new LlmError('llm_refused');
      if(choice?.finish_reason==='length')throw new LlmError('llm_truncated');
      if(typeof message?.content!=='string'||!message.content.trim()||message.content.length>65536)throw new LlmError('llm_malformed');
      let content=message.content;
      if(wrapped){
        let envelope:unknown;try{envelope=JSON.parse(content);}catch{throw new LlmError('llm_malformed');}
        if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==1||!Object.hasOwn(envelope,'result'))throw new LlmError('llm_malformed');
        content=JSON.stringify((envelope as {result:unknown}).result);
      }
      const count=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
      signal.throwIfAborted();
      return {text:content,latencyMs:performance.now()-started,model:typeof parsed.model==='string'&&parsed.model.length<=200?parsed.model:this.model,source:'llm',fixtureLabel:null,usage:{promptTokens:count(parsed.usage?.prompt_tokens),completionTokens:count(parsed.usage?.completion_tokens)}};
    }catch(error){request.signal.throwIfAborted();if(timeout.aborted)throw new LlmError('llm_timeout');if(error instanceof LlmError)throw error;throw new LlmError('llm_unreachable');}
  }
}
