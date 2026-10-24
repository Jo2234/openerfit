import { expect,test } from 'vitest';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import { NoneLlmAdapter } from '../../src/agent/llm/adapter';
import type { LlmResult } from '../../src/agent/llm/adapter';
import { harness,TestAdapter,completed,deferred,request } from './helpers';
for(const phase of ['brief_claims','baseline'] as const)test(`A9: cancellation during ${phase} defeats stale completion and late SSE receives cancelled`,async()=>{
  const entered=deferred<void>(),late=deferred<LlmResult>();let afterAbortCalls=0;
  const adapter=new TestAdapter(r=>{
    if(r.signal.aborted)afterAbortCalls++;
    if(r.schemaName===phase){entered.resolve();return late.promise;}
    return completed(r.schemaName==='planner_action'?'{"action":"finish"}':'{"claimIds":[]}');
  });
  const h=await harness(adapter);const observed=h.pending.catch(error=>error);
  try{await entered.promise;expect(h.store.cancel(h.run.id)).toBe(true);late.resolve(completed(phase==='baseline'?'{"openerRanking":[],"partners":{"brand":[],"place":[],"podcast":[]},"rationale":[]}':'{"claimIds":[]}'));await observed;
    const final=h.store.get(h.run.id)!;expect(final.state).toBe('cancelled');expect(final.brief).toBeNull();expect(afterAbortCalls).toBe(0);
    const events:any[]=[];h.store.subscribe(h.run.id,e=>events.push(e));expect(events[0]).toEqual({event:'state',data:{state:'cancelled'}});expect(events.at(-1).event).toBe('done');expect(events.at(-1).data.state).toBe('cancelled');
  }finally{late.resolve(completed('{"claimIds":[]}'));h.store.close();}
});
test('A9: cancel during a delayed partner call aborts signal and starts no later tool/model call',async()=>{
  const entered=deferred<void>(),release=deferred<void>();const client=new FixtureQlooClient();const original=client.insights.bind(client);let calls=0;let abortedSignal:AbortSignal|undefined;
  client.insights=async(args,signal)=>{calls++;if(args.type==='urn:entity:brand'){abortedSignal=signal;entered.resolve();await release.promise;signal?.throwIfAborted();}return original(args,signal);};
  const h=await harness(new NoneLlmAdapter(),client,request(),false);const observed=h.pending.catch(error=>error);
  try{await entered.promise;h.store.cancel(h.run.id);release.resolve();await observed;expect(abortedSignal?.aborted).toBe(true);expect(calls).toBe(2);expect(h.store.get(h.run.id)?.state).toBe('cancelled');}finally{release.resolve();h.store.close();}
});
