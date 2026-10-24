import type { LlmAdapter,LlmRequest,LlmResult } from '../../src/agent/llm/adapter';
import type { BriefRequest, ConfirmedResolutions, ResolveResponse, Run } from '../../src/shared/types';
import { createApplicationServices } from '../../src/agent/services';
import { parseEnv } from '../../src/server/env';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import type { QlooClient } from '../../src/qloo/client';
import { RunStore,newRunId } from '../../src/server/run-store';
import scenarios from '../../fixtures/scenarios.json';
export const request=()=>structuredClone(scenarios[0].request) as BriefRequest;
export const completed=(text:string,source:'llm'|'fixture'='fixture'):LlmResult=>({text,latencyMs:0,model:source==='llm'?'synthetic-stub-model':'hand-written fixture',source,fixtureLabel:source==='fixture'?'Hand-written test fixture, not a model output.':null,usage:{promptTokens:null,completionTokens:null}});
export class TestAdapter implements LlmAdapter {
  readonly mode='fixture' as const;readonly model='hand-written fixture';readonly requests:LlmRequest[]=[];
  constructor(private handler:(request:LlmRequest)=>Promise<LlmResult>|LlmResult){}
  async complete(req:LlmRequest){this.requests.push(req);return this.handler(req);}
  async health(){return null;}
}
export function confirmations(e:Omit<ResolveResponse,'resolveId'>):ConfirmedResolutions {
  const head=e.headliner.chosen!;
  return {headliner:{entityId:head.entityId,name:head.name,receiptId:head.receiptId},roster:e.roster.map(row=>{const chosen=row.target==='r2'||row.target==='r7'?row.candidates[0]:row.chosen;return {rowId:row.target,entityId:chosen?.entityId??null,name:chosen?.name??null,receiptId:chosen?.receiptId??null,status:chosen?'user_confirmed':'not_found'};})};
}
export function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
/** Integration helper is drafted only; do not invoke its file without a grant. */
export async function harness(adapter:LlmAdapter,client:QlooClient=new FixtureQlooClient(),input=request(),baseline=true,env=parseEnv({})){
  const services=createApplicationServices(env,adapter);const evidence=await services.resolve({headlinerQuery:input.headlinerQuery,roster:input.roster},client,new AbortController().signal);
  const run:Run={id:newRunId(),state:'queued',request:input,resolutions:confirmations(evidence),options:{planner:'auto',baseline},steps:[],brief:null,baseline:null,diff:null,error:null,startedAt:'2026-10-18T00:00:00.000Z',finishedAt:null,qlooCallCount:0};
  const store=new RunStore();const signal=store.add(run);
  const counted:QlooClient={mode:client.mode,search:async()=>{throw new Error('Search not allowed during run');},insights:async(args,s)=>{signal.throwIfAborted();store.countCall(run.id);return client.insights(args,s);},tags:async(args,s)=>{signal.throwIfAborted();store.countCall(run.id);return client.tags(args,s);}};
  const pending=services.execute({run,client:counted,searchReceipts:evidence.receipts,searchOrigins:evidence.origins,signal,transition:state=>store.transition(run.id,state),step:step=>store.step(run.id,step)}).then(result=>{store.complete(run.id,result);return store.get(run.id)!;});
  return {store,run,signal,pending,evidence};
}
