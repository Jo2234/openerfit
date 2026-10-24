import type { AppEnv } from '../server/env';
import scenarios from '../../fixtures/scenarios.json';
import type { ExecutionContext } from '../server/app';
import { buildBrief } from '../domain/brief';
import { diffBaseline } from '../domain/baseline-diff';
import type { LlmAdapter } from './llm/adapter';
import { ToolSession } from './tools';
import { planPartners } from './loop';
import { selectBrief } from './writer';
import { runBaseline } from './baseline';
/** Exact fixture roster identity only; unsupported inputs never inherit another scenario's model fixture. */
export function fixtureScenario(context:ExecutionContext):string|null {
  const request=context.run.request;
  return scenarios.find(s=>s.request.headlinerQuery===request.headlinerQuery&&JSON.stringify(s.request.roster.map(r=>[r.rowId,r.name]))===JSON.stringify(request.roster.map(r=>[r.rowId,r.name])))?.id??null;
}
export async function executeRun(context:ExecutionContext,adapter:LlmAdapter,config?:AppEnv['llm']) {
  const {run,signal}=context;const session=new ToolSession(context);const scenarioId=fixtureScenario(context);
  const transition=(state:'ranking'|'partners'|'writing'|'baseline')=>{signal.throwIfAborted();if(!context.transition(state)){signal.throwIfAborted();throw new Error('Run is terminal');}};
  transition('ranking');const ranking=await session.rank();signal.throwIfAborted();
  transition('partners');await planPartners(session,adapter,scenarioId,config?.plannerMaxTokens);signal.throwIfAborted();
  transition('writing');const partners=run.request.partnerCategories.flatMap(category=>{const p=session.partners.get(category);return p?[p]:[];});
  const ctx={request:run.request,ranking,partners,receipts:[...session.receipts.values()]};
  const written=await selectBrief(ctx,adapter,signal,scenarioId,config?.writerMaxTokens);signal.throwIfAborted();
  const brief=buildBrief({...ctx,runId:run.id,createdAt:new Date().toISOString(),selection:written.selection,writer:written.writer,origins:[...session.origins],systemNotes:session.observations});
  for(const step of session.steps)for(const id of step.receiptIds)if(!brief.receipts.some(r=>r.id===id))throw new Error('Trace receipt closure failed');
  let baseline=null;
  if(run.options.baseline){transition('baseline');baseline=await runBaseline(run.request,adapter,signal,scenarioId,config?.baselineMaxTokens);signal.throwIfAborted();}
  const diff=baseline?.status==='ok'&&baseline.output?diffBaseline(baseline.output,run.request,ranking,partners):null;
  signal.throwIfAborted();return {brief,baseline,diff};
}
