import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getConnInfo } from '@hono/node-server/conninfo';
import scenarios from '../../fixtures/scenarios.json';
import type { AppEnv } from './env';
import { safeUrlHost } from './env';
import type { AgentStep, DataOrigin, BaselineDiff, BaselineResult, Brief, Receipt, ResolveRequest, Run, RunState } from '../shared/types';
import { createRunRequestSchema, resolveRequestSchema } from '../shared/schemas';
import { QlooError } from '../qloo/errors';
import { QlooParamError } from '../qloo/params';
import type { QlooClient } from '../qloo/client';
import { RunStore, newRunId } from './run-store';
import { ResolveStore, BoundaryError, type ResolveEvidence } from './resolve-store';
import { RateLimiter } from './rate-limit';
export interface ExecutionContext {
  run:Run; client:QlooClient; searchReceipts:Receipt[]; searchOrigins?:DataOrigin[]; signal:AbortSignal;
  transition:(state:RunState)=>boolean; step:(step:AgentStep)=>boolean;
}
// S2/S3 inject real domain/agent modules here. No production mock orchestrator.
export interface ApplicationServices {
  normalize:(name:string)=>string;
  resolve:(request:ResolveRequest,client:QlooClient,signal:AbortSignal)=>Promise<ResolveEvidence>;
  execute:(context:ExecutionContext)=>Promise<{brief:Brief;baseline:BaselineResult|null;diff:BaselineDiff|null}>;
  exportBrief:(brief:Brief,format:'md'|'html')=>string;
  entityExcerpt?:(runId:string,receipt:Receipt)=>unknown;
}
export interface AppDependencies {env:AppEnv;client:QlooClient;services?:ApplicationServices;runs?:RunStore;now?:()=>number;gitSha?:string;version?:string}
async function jsonBody(request:Request):Promise<unknown>{
  const limit=65536;if(Number(request.headers.get('content-length'))>limit)throw new BoundaryError('body_too_large','Request exceeds 64 KB.',413);
  const reader=request.body?.getReader();if(!reader)throw new BoundaryError('invalid_request','JSON body required.');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new BoundaryError('body_too_large','Request exceeds 64 KB.',413);chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BoundaryError('invalid_request','Malformed JSON body.');}
}
function excerpt(value:unknown):unknown {
  if(!value||typeof value!=='object')return null;
  const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['akas','short_descriptions','external'].includes(k)).map(([k,a])=>[k,clean(a)])):v;
  const result=clean(value);return Buffer.byteLength(JSON.stringify(result))<=4096?result:null;
}
export function createApp(deps:AppDependencies){
  const {env,client,services}=deps;const now=deps.now??Date.now;const runs=deps.runs??new RunStore(50,2*3600000,now);const resolves=services?new ResolveStore(services.normalize,100,30*60000,now):null;const limiter=new RateLimiter(now);const app=new Hono();
  app.use('*',async(c,next)=>{
    c.header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'");c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');if(c.req.path.startsWith('/api/'))c.header('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
      if(Number(c.req.header('content-length'))>65536)throw new BoundaryError('body_too_large','Request exceeds 64 KB.',413);
      const origin=c.req.header('origin');if((origin&&origin!==new URL(c.req.url).origin)||c.req.header('sec-fetch-site')==='cross-site')throw new BoundaryError('cross_origin_rejected','Cross-origin mutations are not accepted.',403);
      if(!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type')??'') && !/^\/api\/runs\/[^/]+\/cancel$/.test(c.req.path))throw new BoundaryError('invalid_request','Use application/json.');
    }
    await next();
  });
  app.onError((err,c)=>{if(err instanceof BoundaryError)return c.json({error:{code:err.code,message:err.message,...(err.issues?{issues:err.issues}:{})}},err.httpStatus as any);if(err instanceof QlooError)return c.json({error:{code:err.code,message:err.message}},err.httpStatus as any);if(err instanceof QlooParamError)return c.json({error:{code:err.code,message:err.message}},400);return c.json({error:{code:'internal_error',message:'The request could not be completed.'}},500);});
  const unavailable=()=>{throw new BoundaryError('integration_unavailable','Domain and agent integration is pending (S2/S3). No booking brief was generated.',503);};
  // Trust only the final hop appended by the deployment proxy, not client-supplied prefixes.
  const limited=(c:any,kind:'resolve'|'runs')=>{if(env.qloo.mode!=='live')return;let ip='unknown';if(env.trustProxy)ip=c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()||'unknown';else try{ip=getConnInfo(c).remote.address??'unknown';}catch{}if(!limiter.allow(`${kind}:${ip}`,kind==='resolve'?20:6)||(kind==='runs'&&!limiter.allow('runs:global',60)))throw new BoundaryError('rate_limited','This demo limits runs per hour to protect the shared API quota. Try again later.',429);};
  app.get('/api/health',c=>c.json({ok:true,version:deps.version??'0.1.0',gitSha:deps.gitSha??'unknown',qloo:{mode:env.qloo.mode,keyPresent:!!env.qloo.apiKey,baseUrl:safeUrlHost(env.qloo.baseUrl)},llm:{mode:env.llm.mode,model:env.llm.model,reachable:null},scenarios:scenarios.filter(s=>env.qloo.mode==='fixture'?s.synthetic:s.liveSafe).map(s=>s.id),integration:{domain:!!services,agent:!!services}}));
  app.get('/api/scenarios',c=>c.json(scenarios.filter(s=>env.qloo.mode==='fixture'?s.synthetic:s.liveSafe)));
  app.post('/api/resolve',async c=>{const parsed=resolveRequestSchema.safeParse(await jsonBody(c.req.raw));if(!parsed.success)throw new BoundaryError('invalid_request','Invalid resolve request.');limited(c,'resolve');if(!services||!resolves)return unavailable();const input=parsed.data;if(new Set(input.roster.map(r=>r.rowId)).size!==input.roster.length)throw new BoundaryError('invalid_request','Duplicate row IDs.');let calls=0;const signal=c.req.raw.signal;const resolveClient:QlooClient={mode:client.mode,search:(args)=>{signal.throwIfAborted();if(++calls>26)throw new BoundaryError('resolve_budget_exhausted','Resolution search budget exhausted.',429);return client.search(args,signal);},insights:async()=>{throw new BoundaryError('invalid_tool','Insights are not allowed during resolution.');},tags:async()=>{throw new BoundaryError('invalid_tool','Tags are not allowed during resolution.');}};const evidence=await services.resolve(input,resolveClient,signal);const resolveId=resolves.put(input,evidence);return c.json({resolveId,headliner:evidence.headliner,roster:evidence.roster,receipts:evidence.receipts});});
  app.post('/api/runs',async c=>{
    const parsed=createRunRequestSchema.safeParse(await jsonBody(c.req.raw));if(!parsed.success)throw new BoundaryError('invalid_request','Invalid run request.');limited(c,'runs');if(!services||!resolves)return unavailable();
    const input=parsed.data;const names=input.request.roster.map(r=>services.normalize(r.name));if(new Set(names).size!==names.length)throw new BoundaryError('duplicate_roster_name','Roster names must be unique.');
    const verified=resolves.verify(input.resolveId,input.request,input.resolutions);const run:Run={id:newRunId(),state:'queued',request:input.request,resolutions:verified.resolutions,options:input.options,steps:[],brief:null,baseline:null,diff:null,error:null,startedAt:new Date(now()).toISOString(),finishedAt:null,qlooCallCount:0};const signal=runs.add(run);
    const counted:QlooClient={mode:client.mode,search:async()=>{throw new BoundaryError('invalid_tool','Search is not allowed after resolution.');},insights:async(p)=>{signal.throwIfAborted();if(!runs.countCall(run.id))throw new Error('Run is terminal');return client.insights(p,signal);},tags:async(p)=>{signal.throwIfAborted();if(!runs.countCall(run.id))throw new Error('Run is terminal');return client.tags(p,signal);}};
    void Promise.resolve().then(()=>{signal.throwIfAborted();return services.execute({run:structuredClone(run),client:counted,searchReceipts:verified.evidence.receipts,searchOrigins:verified.evidence.origins,signal,transition:state=>runs.transition(run.id,state),step:step=>runs.step(run.id,step)});}).then(result=>runs.complete(run.id,result)).catch(error=>{if(signal.aborted)return;const safe=error instanceof QlooError?{code:error.code,message:error.message}:{code:'run_failed',message:'The run could not be completed. Nothing was invented.'};runs.fail(run.id,safe);});
    return c.json({runId:run.id},202);
  });
  const requireRun=(id:string)=>{const run=runs.get(id);if(!run)throw new BoundaryError('run_not_found','Run not found.',404);return run;};
  app.get('/api/runs/:id',c=>c.json(requireRun(c.req.param('id'))));
  app.get('/api/runs/:id/events',c=>{requireRun(c.req.param('id'));return streamSSE(c,async stream=>{
    let stop:(()=>void)|null=null;let finish!:()=>void;const finished=new Promise<void>(r=>{finish=r;});let chain=Promise.resolve();
    stop=runs.subscribe(c.req.param('id'),event=>{chain=chain.then(()=>stream.writeSSE({event:event.event,data:JSON.stringify(event.data)})).then(()=>{if(event.event==='done'||event.event==='error')finish();}).catch(()=>finish());});
    stream.onAbort(()=>{stop?.();finish();});if(!stop)finish();await finished;stop?.();await chain;
  });});
  app.post('/api/runs/:id/cancel',c=>{const run=requireRun(c.req.param('id'));if(['done','failed','cancelled'].includes(run.state))throw new BoundaryError('run_finished','Run already finished.',409);runs.cancel(run.id);return c.json({state:'cancelled'});});
  for(const format of ['md','html'] as const)app.get(`/api/runs/:id/export.${format}`,c=>{const run=requireRun(c.req.param('id'));if(run.state!=='done'||!run.brief)throw new BoundaryError('run_not_done','Brief is not complete.',409);if(!services)return unavailable();c.header('Content-Type',format==='md'?'text/markdown; charset=UTF-8':'text/html; charset=UTF-8');return c.body(services.exportBrief(run.brief,format));});
  app.get('/api/runs/:id/receipts/:rid',c=>{const run=requireRun(c.req.param('id'));const receipt=run.brief?.receipts.find(r=>r.id===c.req.param('rid'));if(!receipt)throw new BoundaryError('receipt_not_found','Receipt not found.',404);return c.json({receipt,entityExcerpt:excerpt(services?.entityExcerpt?.(run.id,receipt))});});
  app.all('/api/*',c=>c.json({error:{code:'not_found',message:'API route not found.'}},404));
  return {app,runs};
}
