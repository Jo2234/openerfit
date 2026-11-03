import { expect,test,vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { OpenAICompatibleAdapter } from '../../src/agent/llm/openai-compatible';
import type { LlmRequest } from '../../src/agent/llm/adapter';
import { parseEnv } from '../../src/server/env';
import { harness } from './helpers';
const config=()=>({...parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-test',LLM_BASE_URL:'https://api.groq.com/openai/v1'}).llm,timeoutMs:45000});
const request=(signal=new AbortController().signal):LlmRequest=>({schemaName:'planner_action',system:'Synthetic',user:'Synthetic',jsonSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},maxTokens:50,signal,fixtureKey:{scenarioId:null,step:0}});
const limited=(retryAfter?:string,status=429)=>new Response('private-provider-error',{status,headers:retryAfter===undefined?{}:{'retry-after':retryAfter}});
const success=()=>Response.json({choices:[{message:{content:'{"ok":true}'}}]});
test('Groq honours a 24 second Retry-After with identical request and shared signal',async()=>{
  const first=limited('24'),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{}),inits:RequestInit[]=[];
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{inits.push(init!);return inits.length===1?first:success();});
  await expect(new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request())).resolves.toMatchObject({source:'llm'});
  expect(fetch).toHaveBeenCalledTimes(2);expect(delay).toHaveBeenCalledExactlyOnceWith(24000,expect.any(AbortSignal));
  expect(inits[1]).toEqual(inits[0]);expect(inits[1].body).toBe(inits[0].body);expect(inits[1].signal).toBe(inits[0].signal);
  expect(first.bodyUsed).toBe(true);expect(first.body?.locked).toBe(false);
});
test('Groq fails immediately when Retry-After cannot fit the remaining call deadline',async()=>{
  const response=limited('99'),fetch=vi.fn(async()=>response),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const error=await new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_rate_limited');expect(String(error)).not.toContain('private-provider-error');
  expect(fetch).toHaveBeenCalledTimes(1);expect(delay).not.toHaveBeenCalled();expect(response.bodyUsed).toBe(true);expect(response.body?.locked).toBe(false);
});
test('Groq compares against remaining time, retaining one second response headroom',async()=>{
  let clock=0;const now=vi.spyOn(performance,'now').mockImplementation(()=>clock),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  try{const fetch=vi.fn(async()=>{clock=20001;return limited('24');});
    await expect(new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request())).rejects.toMatchObject({code:'llm_rate_limited'});
    expect(fetch).toHaveBeenCalledTimes(1);expect(delay).not.toHaveBeenCalled();
  }finally{now.mockRestore();}
});
test.each([undefined,'not numeric','1'])('Groq exhausted 429s report quota with bounded backoff (%s)',async value=>{
  const fetch=vi.fn(async()=>limited(value)),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  await expect(new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request())).rejects.toMatchObject({code:'llm_rate_limited'});
  expect(fetch).toHaveBeenCalledTimes(3);expect(delay.mock.calls.map(c=>c[0])).toEqual(value==='1'?[1000,1000]:[1000,3000]);
});
test('503 keeps existing capped Retry-After, attempt count and upstream classification',async()=>{
  const fetch=vi.fn(async()=>limited('99',503)),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  await expect(new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request())).rejects.toMatchObject({code:'llm_upstream'});
  expect(fetch).toHaveBeenCalledTimes(3);expect(delay.mock.calls.map(c=>c[0])).toEqual([10000,10000]);
});
test.each(['caller','timeout'])('Groq wait respects %s cancellation',async mode=>{
  const controller=new AbortController(),fetch=vi.fn(async()=>limited(mode==='caller'?'24':'0'));
  const delay=vi.fn(async(_ms:number,signal:AbortSignal)=>{if(mode==='caller')controller.abort(new Error('caller reason'));await sleep(5000,undefined,{signal});});
  const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:mode==='caller'?45000:1100},{fetch,delay}).complete(request(controller.signal)).catch(e=>e);
  if(mode==='caller')expect(error).toBe(controller.signal.reason);else expect(error.code).toBe('llm_timeout');
  expect(fetch).toHaveBeenCalledTimes(1);expect(delay).toHaveBeenCalledTimes(1);
});
test('quota classification reaches writer and baseline without claiming model output',async()=>{
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>JSON.parse(String(init?.body)).response_format.json_schema.name==='planner_action'?Response.json({choices:[{message:{content:'{"result":{"action":"finish"}}'}}]}):limited('99'));
  const h=await harness(new OpenAICompatibleAdapter(config(),{fetch}));
  try{const run=await h.pending;expect(run.brief?.writer).toMatchObject({kind:'template',source:null,fallbackReason:'llm_rate_limited'});expect(run.baseline).toMatchObject({status:'error',source:null,error:{code:'llm_rate_limited'}});expect(fetch).toHaveBeenCalledTimes(3);}finally{h.store.close();}
});
