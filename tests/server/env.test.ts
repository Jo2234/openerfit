import { expect,it } from 'vitest';
import { parseEnv,safeUrlHost } from '../../src/server/env';
it('Q8: live requires key; a key alone never activates live; timeout override is not env controlled',()=>{expect(()=>parseEnv({QLOO_MODE:'live'})).toThrow('QLOO_API_KEY');expect(parseEnv({QLOO_API_KEY:'sentinel'}).qloo.mode).toBe('fixture');expect((parseEnv({QLOO_HTTP_TIMEOUT_MS:'1'}).qloo as any).timeoutMs).toBeUndefined();});
it('protects base URL and masks LLM userinfo/query',()=>{for(const url of ['https://evil.example','https://hackathon.api.qloo.com/path','http://127.0.0.1:99/?key=secret','https://user:secret@hackathon.api.qloo.com'])expect(()=>parseEnv({QLOO_BASE_URL:url})).toThrow();expect(safeUrlHost('https://user:secret@example.com/v1?key=secret')).toBe('example.com');});
it('LLM transport defaults, overrides and safe validation',()=>{
  expect(parseEnv({}).llm).toMatchObject({supportsSeed:true,reasoningEffort:null,plannerMaxTokens:300,writerMaxTokens:1200,baselineMaxTokens:900});
  expect(parseEnv({LLM_SUPPORTS_SEED:'0',LLM_REASONING_EFFORT:'minimal',LLM_PLANNER_MAX_TOKENS:'1024',LLM_WRITER_MAX_TOKENS:'2048',LLM_BASELINE_MAX_TOKENS:'4096'}).llm).toMatchObject({supportsSeed:false,reasoningEffort:'minimal',plannerMaxTokens:1024,writerMaxTokens:2048,baselineMaxTokens:4096});
  for(const key of ['LLM_SUPPORTS_SEED','LLM_REASONING_EFFORT','LLM_PLANNER_MAX_TOKENS','LLM_WRITER_MAX_TOKENS','LLM_BASELINE_MAX_TOKENS']){try{parseEnv({[key]:'SENSITIVE_INVALID'});throw new Error('accepted');}catch(error){expect(String(error)).not.toContain('SENSITIVE_INVALID');expect(String(error)).toContain('value not printed');}}
  for(const value of ['63','16385','100.5',''])expect(()=>parseEnv({LLM_WRITER_MAX_TOKENS:value})).toThrow();
});
