import { expect,test } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatibleAdapter } from '../../src/agent/llm/openai-compatible';
import { parseEnv } from '../../src/server/env';
import { TestAdapter,completed,harness } from './helpers';
import { exportBrief } from '../../src/domain/brief';
import { runBaseline } from '../../src/agent/baseline';
import { scenario } from '../domain/helpers';
test('A12/provenance: fixture Qloo with injected real-source LLM stays llm; baseline uses same model/full inputs',async()=>{
  const requests:any[]=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);const schema=body.response_format.json_schema.name;
    const content=schema==='planner_action'?'{"result":{"action":"finish"}}':schema==='brief_claims'?'{"claimIds":[]}':'{"openerRanking":[],"partners":{"brand":[],"place":[],"podcast":[]},"rationale":[]}';
    res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'synthetic-stub-model',choices:[{message:{content}}]}));
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let h:Awaited<ReturnType<typeof harness>>|undefined;
  try{const adapter=new OpenAICompatibleAdapter(parseEnv({LLM_MODE:'openai-compatible',LLM_MODEL:'synthetic-stub-model',LLM_BASE_URL:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`}).llm);h=await harness(adapter);const run=await h.pending;
    expect(run.brief?.origins).toEqual(['fixture']);expect(run.brief?.writer).toMatchObject({source:'llm',fixtureLabel:null,model:'synthetic-stub-model'});expect(run.baseline).toMatchObject({source:'llm',fixtureLabel:null,model:'synthetic-stub-model'});expect(exportBrief(run.brief!,'html')).toContain('Writer selection source: language model.');expect(exportBrief(run.brief!,'html')).not.toContain('Hand-written fixture selector');
    const baseline=requests.find(r=>r.response_format.json_schema.name==='baseline').messages[1].content,writer=requests.find(r=>r.response_format.json_schema.name==='brief_claims').messages[1].content;const user=JSON.stringify({booker_input:run.request});expect(baseline).toContain(user);expect(writer).toContain(user);expect(baseline).not.toContain('qloo_observations');expect(baseline).not.toContain('R-');
  }finally{h?.store.close();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('A12: invalid baseline repairs once without Qloo leakage, and fails without breaking a brief',async()=>{
  const adapter=new TestAdapter(()=>completed('not JSON'));const s=scenario();const result=await runBaseline(s.request,adapter,new AbortController().signal,null);expect(result.status).toBe('invalid_output');expect(result.output).toBeNull();expect(adapter.requests).toHaveLength(2);expect(adapter.requests[1].user).not.toContain('not JSON');expect(adapter.requests[1].user).not.toContain('qloo_observations');
});
