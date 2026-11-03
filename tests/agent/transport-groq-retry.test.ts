import { expect,test,vi } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/agent/llm/openai-compatible';
import type { LlmRequest } from '../../src/agent/llm/adapter';
import { parseEnv } from '../../src/server/env';
const key='synthetic-private-key',message='private-message-marker',generation='private-generation-marker';
const config=(baseUrl='https://api.groq.com/openai/v1')=>parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-test',LLM_BASE_URL:baseUrl,LLM_API_KEY:key}).llm;
const request=(signal=new AbortController().signal):LlmRequest=>({schemaName:'planner_action',system:'Synthetic',user:'Synthetic',jsonSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},maxTokens:1024,signal,fixtureKey:{scenarioId:null,step:0}});
const errorBody=(code='json_validate_failed')=>JSON.stringify({error:{code,message:message+key,failed_generation:generation}});
const failure=(status=400)=>new Response(errorBody(),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const success=()=>Response.json({choices:[{message:{content:'{"ok":true}'}}]});
function privateError(error:unknown){for(const marker of [key,message,generation]){expect(String(error)).not.toContain(marker);expect(JSON.stringify(error)).not.toContain(marker);expect((error as Error).message).not.toContain(marker);}}
test('Groq retries once immediately with identical strict request and private error input',async()=>{
  const first=failure(),inits:RequestInit[]=[],urls:unknown[]=[],delay=vi.fn(async()=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);return inits.length===1?first:success();});
  const result=await new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request());
  expect(fetch).toHaveBeenCalledTimes(2);expect(result).toMatchObject({source:'llm',text:'{"ok":true}'});
  expect(inits[0].body).toBe(inits[1].body);expect(typeof inits[0].body).toBe('string');
  expect(JSON.parse(inits[0].body as string)).toMatchObject({model:'synthetic-test',temperature:0,seed:42,max_tokens:1024,response_format:{type:'json_schema',json_schema:{name:'planner_action',strict:true}}});
  expect(urls[0]).toBe(urls[1]);expect(inits[0].headers).toBe(inits[1].headers);expect(inits[0].signal).toBe(inits[1].signal);expect(inits.map(i=>i.redirect)).toEqual(['error','error']);
  expect(first.bodyUsed||first.body?.locked===false).toBe(true);expect(delay).not.toHaveBeenCalled();
  for(const marker of [key,message,generation])expect(JSON.stringify(result)).not.toContain(marker);
});
test('repeated matching 400 stops after two requests without exposing error input',async()=>{
  const fetch=vi.fn(async()=>failure()),delay=vi.fn(async()=>{});
  const error=await new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_upstream');privateError(error);expect(fetch).toHaveBeenCalledTimes(2);expect(delay).not.toHaveBeenCalled();
});
const cases=[
  ['unrelated code',()=>new Response(errorBody('other'),{status:400,headers:{'content-type':'application/json'}})],
  ['message only',()=>Response.json({error:{message:'json_validate_failed '+message+key}},{status:400})],
  ['raw text',()=>new Response('json_validate_failed '+message+key,{status:400})],
  ['non JSON',()=>new Response(errorBody(),{status:400,headers:{'content-type':'application/jsonp'}})],
  ['malformed',()=>new Response('{'+message+key,{status:400,headers:{'content-type':'application/json'}})],
  ['oversized stream',()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(errorBody()+' '.repeat(131073)));}}),{status:400,headers:{'content-type':'application/json'}})],
  ...[401,402,403].map(status=>[String(status),()=>failure(status)] as const),
] as const;
test.each(cases)('no retry for %s',async(_name,make)=>{
  const response=make(),fetch=vi.fn(async()=>response);
  const error=await new OpenAICompatibleAdapter(config(),{fetch}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_upstream');privateError(error);expect(fetch).toHaveBeenCalledTimes(1);expect(response.body?.locked).toBe(false);expect(response.bodyUsed).toBe(true);
});
test.each(['http://127.0.0.1:1/v1','https://example.com/openai/v1','https://api.groq.com/v1','http://api.groq.com/openai/v1','https://api.groq.com:444/openai/v1'])('no retry for endpoint %s',async base=>{
  const fetch=vi.fn(async()=>failure());const error=await new OpenAICompatibleAdapter(config(base),{fetch}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_upstream');privateError(error);expect(fetch).toHaveBeenCalledTimes(1);
});
test.each(['caller','timeout'])('stalled 400 reader respects %s abort and cancels',async mode=>{
  const controller=new AbortController(),cancel=vi.fn(),pull=vi.fn(()=>{if(mode==='caller')queueMicrotask(()=>controller.abort(new Error('caller reason')));});
  const response=new Response(new ReadableStream({pull,cancel}),{status:400,headers:{'content-type':'application/json'}}),fetch=vi.fn(async()=>response);
  const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:20},{fetch}).complete(request(controller.signal)).catch(e=>e);
  if(mode==='caller')expect(error).toBe(controller.signal.reason);else expect(error.code).toBe('llm_timeout');
  expect(fetch).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalled();expect(response.body?.locked).toBe(false);
});
test('Groq validation retry shares three attempt cap with rate limit retries',async()=>{
  const fetch=vi.fn(async()=>fetch.mock.calls.length===1?failure():new Response('',{status:429})),delay=vi.fn(async()=>{});
  await expect(new OpenAICompatibleAdapter(config(),{fetch,delay}).complete(request())).rejects.toMatchObject({code:'llm_rate_limited'});
  expect(fetch).toHaveBeenCalledTimes(3);expect(delay).toHaveBeenCalledExactlyOnceWith(3000,expect.any(AbortSignal));
});

// Schema recovery composes with transient responses without adding a fourth fetch.
const quota=(retryAfter='1')=>new Response(errorBody('rate_limit_exceeded'),{status:429,headers:{'retry-after':retryAfter}});
function unchangedAttempts(urls:unknown[],inits:RequestInit[],responses:Response[]){
  for(const [i,init] of inits.entries()){expect(urls[i]).toBe(urls[0]);expect(init.body).toBe(inits[0].body);expect(init.headers).toBe(inits[0].headers);expect(init.signal).toBe(inits[0].signal);expect(init.redirect).toBe('error');}
  for(const response of responses.filter(r=>!r.ok)){expect(response.bodyUsed).toBe(true);expect(response.body?.locked).toBe(false);}
}
const sequences=[
  ['quota/schema/success',[429,400,200],[1000],null],
  ['schema/quota/success',[400,429,200],[1000],null],
  ['quota/schema/schema',[429,400,400],[1000],'llm_upstream'],
  ['schema/quota/schema',[400,429,400],[1000],'llm_upstream'],
  ['quota/quota/schema',[429,429,400],[1000,1000],'llm_upstream'],
  ['quota/quota/quota',[429,429,429],[1000,1000],'llm_rate_limited'],
  ['503/schema/success',[503,400,200],[1000],null],
] as const;
test.each(sequences)('bounded composition: %s',async(_label,statuses,waits,code)=>{
  const urls:unknown[]=[],inits:RequestInit[]=[],responses:Response[]=[],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);const status=statuses[inits.length-1];if(status===undefined)throw Error('unexpected extra fetch');const response=status===429?quota():status===400?failure():status===503?new Response(errorBody(),{status:503}):success();responses.push(response);return response;});
  const result=await new OpenAICompatibleAdapter({...config(),timeoutMs:45000},{fetch,delay}).complete(request()).catch(e=>e);
  if(code){expect(result.code).toBe(code);privateError(result);}else expect(result).toMatchObject({source:'llm',text:'{"ok":true}'});
  expect(fetch).toHaveBeenCalledTimes(statuses.length);expect(delay.mock.calls.map(c=>c[0])).toEqual(waits);unchangedAttempts(urls,inits,responses);
});
test.each(cases)('post-quota unqualified response %s does not retry',async(_name,make)=>{
  const responses=[quota(),make()],urls:unknown[]=[],inits:RequestInit[]=[],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);return responses[inits.length-1];});
  const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:45000},{fetch,delay}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_upstream');privateError(error);expect(fetch).toHaveBeenCalledTimes(2);expect(delay.mock.calls.map(c=>c[0])).toEqual([1000]);unchangedAttempts(urls,inits,responses);
});
test.each(['http://127.0.0.1:1/v1','https://example.com/openai/v1','https://api.groq.com/v1','http://api.groq.com/openai/v1','https://api.groq.com:444/openai/v1'])('post-quota endpoint %s does not acquire schema recovery',async base=>{
  const urls:unknown[]=[],inits:RequestInit[]=[],responses=[quota(),failure()],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);return responses[inits.length-1];});
  const error=await new OpenAICompatibleAdapter({...config(base),timeoutMs:45000},{fetch,delay}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_upstream');privateError(error);expect(fetch).toHaveBeenCalledTimes(2);expect(delay.mock.calls.map(c=>c[0])).toEqual([1000]);unchangedAttempts(urls,inits,responses);
});
test('non-numeric quota wait composes with schema recovery using existing backoff',async()=>{
  const responses=[quota('Mon, 01 Jan 2024 00:00:00 GMT'),failure(),success()],urls:unknown[]=[],inits:RequestInit[]=[],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);return responses[inits.length-1];});
  expect((await new OpenAICompatibleAdapter({...config(),timeoutMs:45000},{fetch,delay}).complete(request())).source).toBe('llm');
  expect(fetch).toHaveBeenCalledTimes(3);expect(delay.mock.calls.map(c=>c[0])).toEqual([1000]);unchangedAttempts(urls,inits,responses);
});
test('unfitting quota wait remains private and never starts schema recovery',async()=>{
  const response=quota('99'),fetch=vi.fn(async()=>response),delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:45000},{fetch,delay}).complete(request()).catch(e=>e);
  expect(error.code).toBe('llm_rate_limited');privateError(error);expect(fetch).toHaveBeenCalledTimes(1);expect(delay).not.toHaveBeenCalled();expect(response.bodyUsed).toBe(true);expect(response.body?.locked).toBe(false);
});
test.each(['caller','timeout'])('post-quota stalled schema reader respects %s cancellation',async mode=>{
  const controller=new AbortController(),cancel=vi.fn(),urls:unknown[]=[],inits:RequestInit[]=[],responses=[quota('0')],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);if(inits.length===1)return responses[0];const response=new Response(new ReadableStream({pull(){if(mode==='caller')queueMicrotask(()=>controller.abort(new Error('caller reason')));},cancel}),{status:400,headers:{'content-type':'application/json'}});responses.push(response);return response;});
  const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:mode==='caller'?45000:1100},{fetch,delay}).complete(request(controller.signal)).catch(e=>e);
  if(mode==='caller')expect(error).toBe(controller.signal.reason);else expect(error.code).toBe('llm_timeout');privateError(error);
  expect(fetch).toHaveBeenCalledTimes(2);expect(delay.mock.calls.map(c=>c[0])).toEqual([0]);expect(cancel).toHaveBeenCalled();unchangedAttempts(urls,inits,responses);
});
test('one shared 45 second timeout still aborts the third fetch after quota/schema recovery',async()=>{
  const timeout=new AbortController(),timer=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{expect(ms).toBe(45000);return timeout.signal;}),cancel=vi.fn();
  const responses=[quota('25'),failure()],urls:unknown[]=[],inits:RequestInit[]=[],delay=vi.fn(async(_ms:number,_signal:AbortSignal)=>{});
  try{const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{urls.push(url);inits.push(init!);if(inits.length<=2)return responses[inits.length-1];return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{cancel();reject(init!.signal!.reason);},{once:true});queueMicrotask(()=>timeout.abort(new DOMException('Synthetic timeout','TimeoutError')));});});
    const error=await new OpenAICompatibleAdapter({...config(),timeoutMs:45000},{fetch,delay}).complete(request()).catch(e=>e);
    expect(error.code).toBe('llm_timeout');privateError(error);expect(timer).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(3);expect(cancel).toHaveBeenCalledTimes(1);expect(delay.mock.calls.map(c=>c[0])).toEqual([25000]);unchangedAttempts(urls,inits,responses);
  }finally{timer.mockRestore();}
});
