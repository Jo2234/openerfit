import { expect,test } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/agent/llm/openai-compatible';
import type { LlmRequest } from '../../src/agent/llm/adapter';
import { parseEnv } from '../../src/server/env';
import { harness } from './helpers';
const config=()=>parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-test',LLM_BASE_URL:'http://127.0.0.1:1/v1'}).llm;
const request=(signal=new AbortController().signal):LlmRequest=>({schemaName:'planner_action',system:'Synthetic',user:'Synthetic',jsonSchema:{$schema:'test',oneOf:[{type:'object',properties:{action:{const:'finish'},ids:{type:'array',items:{enum:['synthetic']},minItems:0,maxItems:2}},required:['action'],additionalProperties:false}]},maxTokens:1024,signal,fixtureKey:{scenarioId:null,step:0}});
const response=(content:string)=>Response.json({choices:[{message:{content}}]});
test('transport normalizes a cloned union, wraps/unwraps, and honors seed/reasoning options',async()=>{
  const original=request(),snapshot=structuredClone(original.jsonSchema);let body:any;
  const adapter=new OpenAICompatibleAdapter({...config(),supportsSeed:false,reasoningEffort:'none'},{fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return response('{"result":{"action":"finish"}}');}});
  expect(JSON.parse((await adapter.complete(original)).text)).toEqual({action:'finish'});
  expect(original.jsonSchema).toEqual(snapshot);expect(body).not.toHaveProperty('seed');expect(body).toMatchObject({reasoning_effort:'none',max_tokens:1024});
  const schema=body.response_format.json_schema.schema;
  expect(schema).toMatchObject({type:'object',required:['result'],additionalProperties:false,properties:{result:{anyOf:[{required:['action'],additionalProperties:false,properties:{action:{enum:['finish']},ids:{minItems:0,maxItems:2,items:{enum:['synthetic']}}}}]}}});
  for(const key of ['$schema','oneOf','const'])expect(JSON.stringify(schema)).not.toContain(`"${key}":`);
});
test.each(['not json','null','[]','{}','{"action":"finish"}','{"result":{},"extra":true}'])('transport rejects malformed wrapper %s',async content=>{
  await expect(new OpenAICompatibleAdapter(config(),{fetch:async()=>response(content)}).complete(request())).rejects.toMatchObject({code:'llm_malformed'});
});
test('transport retries only 429/503, cancels bodies, caps Retry-After and bounds attempts',async()=>{
  const waits:number[]=[],bodies:Response[]=[];let calls=0;
  const adapter=new OpenAICompatibleAdapter(config(),{delay:async ms=>{waits.push(ms);},fetch:async()=>{
    calls++;if(calls===3)return response('{"result":{"action":"finish"}}');
    const r=new Response('synthetic error',{status:calls===1?429:503,headers:{'retry-after':calls===1?'99':'date not numeric'}});bodies.push(r);return r;
  }});
  await adapter.complete(request());expect(calls).toBe(3);expect(waits).toEqual([10000,3000]);expect(bodies.every(r=>r.body?.locked===false&&r.bodyUsed)).toBe(true);
  for(const status of [429,503,500]){
    let attempts=0;const delays:number[]=[];
    await expect(new OpenAICompatibleAdapter(config(),{fetch:async()=>{attempts++;return new Response('',{status});},delay:async ms=>{delays.push(ms);}}).complete(request())).rejects.toMatchObject({code:'llm_upstream'});
    expect(attempts).toBe(status===500?1:3);expect(delays).toEqual(status===500?[]:[1000,3000]);
  }
});
test('retry backoff is caller-abort and overall-timeout aware',async()=>{
  const controller=new AbortController();let calls=0;
  const adapter=new OpenAICompatibleAdapter(config(),{fetch:async()=>{calls++;return new Response('',{status:429});},delay:async(_ms,signal)=>{controller.abort();signal.throwIfAborted();}});
  const failure=await adapter.complete(request(controller.signal)).catch(error=>error);expect(failure).toBe(controller.signal.reason);expect(calls).toBe(1);
  await expect(new OpenAICompatibleAdapter({...config(),timeoutMs:5},{fetch:async()=>new Response('',{status:503})}).complete(request())).rejects.toMatchObject({code:'llm_timeout'});
});
test('configured caps reach planner, writer and baseline requests through application services',async()=>{
  const bodies:any[]=[];const adapter=new OpenAICompatibleAdapter(config(),{fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);return response(body.response_format.json_schema.name==='planner_action'?'{"result":{"action":"finish"}}':body.response_format.json_schema.name==='brief_claims'?'{"claimIds":[]}':'{"openerRanking":[],"partners":{"brand":[],"place":[],"podcast":[]},"rationale":[]}');}});
  const env=parseEnv({LLM_PLANNER_MAX_TOKENS:'1024',LLM_WRITER_MAX_TOKENS:'2048',LLM_BASELINE_MAX_TOKENS:'4096'});
  const h=await harness(adapter,undefined,undefined,true,env);try{await h.pending;expect(bodies.map(b=>b.max_tokens)).toEqual([1024,2048,4096]);}finally{h.store.close();}
});
