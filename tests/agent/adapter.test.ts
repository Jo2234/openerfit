import { createServer,type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect,test } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/agent/llm/openai-compatible';
import { NoneLlmAdapter,type LlmRequest } from '../../src/agent/llm/adapter';
import { FixtureLlmAdapter } from '../../src/agent/llm/fixture';
import { parseEnv } from '../../src/server/env';
const req=(signal=new AbortController().signal):LlmRequest=>({schemaName:'baseline',system:'Synthetic unit test',user:'Synthetic input',jsonSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},maxTokens:50,signal,fixtureKey:{scenarioId:'fx-sg-indie',step:0}});
async function close(server:Server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
test('A10: local stub verifies strict request, real-source result and llamaCpp flag only when set',async()=>{
  const bodies:any[]=[],headers:any[]=[];
  const server=createServer(async(request,response)=>{let body='';for await(const chunk of request)body+=chunk;bodies.push(JSON.parse(body));headers.push(request.headers);response.setHeader('content-type','application/json');response.end(JSON.stringify({model:'synthetic-stub-model',choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:4,completion_tokens:2}}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const env=parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-stub-model',LLM_BASE_URL:base,LLM_API_KEY:'LLM-SENTINEL'}).llm;
    const result=await new OpenAICompatibleAdapter(env).complete(req());expect(result.source).toBe('llm');expect(result.fixtureLabel).toBeNull();expect(result.text).toBe('{"ok":true}');
    await new OpenAICompatibleAdapter({...env,apiKey:null,llamaCpp:true},{supportsSeed:false}).complete(req());
    expect(bodies[0]).toMatchObject({temperature:0,seed:42,max_tokens:50,response_format:{type:'json_schema',json_schema:{strict:true,name:'baseline'}}});expect(bodies[0]).not.toHaveProperty('chat_template_kwargs');expect(headers[0].authorization).toBe('Bearer LLM-SENTINEL');
    expect(bodies[1].chat_template_kwargs).toEqual({enable_thinking:false});expect(bodies[1]).not.toHaveProperty('seed');expect(headers[1]).not.toHaveProperty('authorization');
  }finally{await close(server);}
});
test('A10: safe failures cover timeout, upstream/refusal/malformed/redirect/reflection and caller abort',async()=>{
  let mode='timeout';const server=createServer((_request,response)=>{
    if(mode==='timeout')return;if(mode==='redirect'){response.writeHead(302,{location:'http://127.0.0.1:1/never'});response.end();return;}
    response.setHeader('content-type','application/json');if(mode==='upstream'){response.writeHead(500);response.end('SECRET upstream');return;}
    if(mode==='escaped-reflection'){response.end('{"choices":[{"message":{"content":"'+Array.from('LLM-SENTINEL').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"}}]}');return;}
    response.end(mode==='malformed'?'not json':JSON.stringify({choices:[{message:mode==='refusal'?{refusal:'SECRET refusal'}:{content:'LLM-SENTINEL'}}]}));
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const config=parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-stub-model',LLM_BASE_URL:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,LLM_API_KEY:'LLM-SENTINEL',LLM_TIMEOUT_MS:'50'}).llm;
    for(const [state,code] of [['timeout','llm_timeout'],['upstream','llm_upstream'],['refusal','llm_refused'],['malformed','llm_malformed'],['redirect','llm_unreachable'],['reflection','llm_credential_reflection'],['escaped-reflection','llm_credential_reflection']]){
      mode=state;let caught:any;try{await new OpenAICompatibleAdapter(config).complete(req());}catch(error){caught=error;}expect(caught?.code).toBe(code);expect(String(caught)).not.toContain('SENTINEL');expect(String(caught)).not.toContain('SECRET');
    }
    const controller=new AbortController();controller.abort();await expect(new OpenAICompatibleAdapter(config).complete(req(controller.signal))).rejects.toBe(controller.signal.reason);
    await expect(new OpenAICompatibleAdapter(config,{fetch:async()=>{throw new TypeError('SECRET network');}}).complete(req())).rejects.toMatchObject({code:'llm_unreachable'});
  }finally{await close(server);}
});
test('A10: none does not execute; fixtures use exact per-request keys with no shared counter',async()=>{
  await expect(new NoneLlmAdapter().complete(req())).rejects.toMatchObject({code:'llm_unavailable'});
  const adapter=new FixtureLlmAdapter();const first=await adapter.complete({...req(),schemaName:'planner_action'});expect(JSON.parse(first.text)).toEqual({action:'search_tags',query:'craft beer'});expect(first.source).toBe('fixture');expect(first.fixtureLabel).toContain('not a model output');
  expect((await adapter.complete({...req(),schemaName:'planner_action'})).text).toBe(first.text);
  await expect(adapter.complete({...req(),fixtureKey:{scenarioId:'unknown',step:0}})).rejects.toMatchObject({code:'llm_fixture_missing'});
});
