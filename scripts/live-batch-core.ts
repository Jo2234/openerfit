/** Injectable batch accounting. No filesystem, environment, client or network action on import. */
import type { QlooCallRecord } from '../src/shared/types';
export type ScriptKind = 'smoke'|'coverage'|'probe';
export type ErrorPolicy = 'stop-first-error'|'continue-on-pair-error';
export const CEILINGS = {smoke:{logical:2,fetch:8},coverage:{logical:25,fetch:100},probe:{logical:16,fetch:64}} as const;
export const REPORT_CEILING = 8 * 1024 * 1024;
export const FINAL_RESERVE = 256 * 1024;
export class BatchRefusal extends Error {
  constructor(readonly code: 'authorization'|'input'|'deadline'|'cancelled'|'logical_cap'|'transport_cap'|'output_cap'|'call_failed'|'report_write'|'response_schema') { super(code); }
}
export interface Limits { workMs:number; cleanupMs:number; reportMs:number; maxLogical:number; maxFetch:number; maxReportBytes:number }
export interface BatchPorts {
  now():number;
  timer(ms:number, fn:()=>void):()=>void;
  atomicReport(text:string, signal:AbortSignal):Promise<void>;
}
export interface CallSlot { id:string; status:'not-run'|'started'|'completed'|'failed'|'aborted'; attempts:number; origin?:'live'|'live-cache'; networkVerified?:boolean; receipt?:unknown; error?:string }
export interface Attempt { call:number; number:number; status:number|null; error:'transport'|'aborted'|null; elapsedMs:number }
export interface Authorization {
  grantId:string; owner:string; threadId:string; checkout:string; branch:string; commit:string;
  proposalSha256:string; inputSha256:string; commands:string[][]; limits:Limits;
  liveBatch:{kind:ScriptKind; errorPolicy:ErrorPolicy; cache:'off'|'allowed'; inputSha256:string; inputPath:string; resultRoot:string; graphSha256:string; runner:{path:string;sha256:string;argv:string[]}; entryArgv:string[]; runnerReviewed:true; baseUrl:string};
}
export interface ExpectedBinding extends Authorization { actualEntry:string[] }
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Explicit selected fields only. Additive coordinator metadata is deliberately accepted. */
export function authorize(active:unknown, expected:ExpectedBinding):void {
  if (!active || typeof active !== 'object') throw new BatchRefusal('authorization');
  const a=active as Authorization;
  for (const key of ['grantId','owner','threadId','checkout','branch','commit','proposalSha256','inputSha256'] as const)
    if (a[key] !== expected[key]) throw new BatchRefusal('authorization');
  if (!same(a.commands,expected.commands) || !same(a.liveBatch?.entryArgv,expected.actualEntry) || !same(expected.liveBatch.entryArgv,expected.actualEntry)) throw new BatchRefusal('authorization');
  for (const key of ['workMs','cleanupMs','reportMs','maxLogical','maxFetch','maxReportBytes'] as const)
    if (a.limits?.[key] !== expected.limits[key]) throw new BatchRefusal('authorization');
  for (const key of ['kind','errorPolicy','cache','inputSha256','inputPath','resultRoot','graphSha256','baseUrl','runnerReviewed'] as const)
    if (a.liveBatch?.[key] !== expected.liveBatch[key]) throw new BatchRefusal('authorization');
  for(const key of ['path','sha256','argv'] as const)if(!same(a.liveBatch?.runner?.[key],expected.liveBatch.runner[key]))throw new BatchRefusal('authorization');
}
export function checkLimits(kind:ScriptKind, limits:Limits, policy:ErrorPolicy):void {
  const ceiling=CEILINGS[kind];
  if (!ceiling || !Number.isInteger(limits.workMs) || limits.workMs<1 || limits.workMs>900_000 ||
      !Number.isInteger(limits.cleanupMs) || limits.cleanupMs<1 || limits.cleanupMs>60_000 ||
      !Number.isInteger(limits.reportMs) || limits.reportMs<1 || limits.reportMs>30_000 ||
      !Number.isInteger(limits.maxLogical) || limits.maxLogical<1 || limits.maxLogical>ceiling.logical ||
      !Number.isInteger(limits.maxFetch) || limits.maxFetch<1 || limits.maxFetch>ceiling.fetch ||
      !Number.isInteger(limits.maxReportBytes) || limits.maxReportBytes<FINAL_RESERVE+65_536 || limits.maxReportBytes>REPORT_CEILING ||
      !['stop-first-error','continue-on-pair-error'].includes(policy) || policy==='continue-on-pair-error' && kind!=='probe') throw new BatchRefusal('authorization');
}
const SAFE_CODES=new Set(['authorization','input','deadline','cancelled','logical_cap','transport_cap','output_cap','call_failed','report_write','response_schema']);
const safeCode = (e:unknown) => e instanceof BatchRefusal && Object.getPrototypeOf(e)===BatchRefusal.prototype && SAFE_CODES.has(e.code) ? e.code : 'call_failed';
export class LiveBatch {
  readonly controller=new AbortController();
  readonly signal=this.controller.signal;
  readonly startedAt:number;
  readonly slots:CallSlot[]=[];
  readonly attempts:Attempt[]=[];
  readonly observations:unknown[]=[];
  firstError:string|null=null;
  reportWriteFailed=false;
  reportWritten=false;
  private current:number|null=null;
  private retained=0;
  private cancelTimer:()=>void;
  private limits:Limits;
  private deadline:number;
  private stopped=false;
  private policy:ErrorPolicy='stop-first-error';
  private metadata:{kind?:ScriptKind;cache?:'off'|'allowed';grantId?:string}={};
  constructor(private readonly ports:BatchPorts, readonly startBudgetMs=900_000) {
    this.startedAt=ports.now(); this.deadline=this.startedAt+startBudgetMs;
    this.limits={workMs:startBudgetMs,cleanupMs:1,reportMs:1,maxLogical:1,maxFetch:1,maxReportBytes:REPORT_CEILING};
    this.cancelTimer=ports.timer(startBudgetMs,()=>this.abort('deadline'));
  }
  configure(kind:ScriptKind, limits:Limits, policy:ErrorPolicy, cache:'off'|'allowed', grantId:string) {
    checkLimits(kind,limits,policy); this.limits=limits; this.policy=policy; this.metadata={kind,cache,grantId};
    this.deadline=Math.min(this.deadline,this.startedAt+limits.workMs);
    this.cancelTimer(); this.cancelTimer=this.ports.timer(Math.max(0,this.deadline-this.ports.now()),()=>this.abort('deadline')); this.check();
  }
  abort(code:'deadline'|'cancelled'|'logical_cap'|'transport_cap'|'output_cap') {
    if (!this.firstError) this.firstError=code;
    this.stopped=true; if (!this.signal.aborted) this.controller.abort(new BatchRefusal(code));
  }
  check() {
    if (this.ports.now()>=this.deadline && !this.signal.aborted) this.abort('deadline');
    if (this.signal.aborted) throw this.signal.reason;
    if (this.stopped) throw new BatchRefusal('call_failed');
  }
  plan(ids:string[]) {
    this.check(); if (this.slots.length || ids.length>this.limits.maxLogical || new Set(ids).size!==ids.length || ids.some(x=>!/^([A-Z][0-9]{1,2})([ab])?$/.test(x))) throw new BatchRefusal('logical_cap');
    this.slots.push(...ids.map(id=>({id,status:'not-run' as const,attempts:0})));
  }
  record(value:unknown) {
    // Callers pass only bounded projections, never complete response bodies or error objects.
    let text:string;try{text=boundedJson(value,65_536);}catch{this.abort('output_cap');throw new BatchRefusal('output_cap');} const bytes=new TextEncoder().encode(text).length;
    if (this.observations.length>=256 || bytes>65_536 || this.retained+bytes>this.limits.maxReportBytes-FINAL_RESERVE) {this.abort('output_cap');throw new BatchRefusal('output_cap');}
    this.retained+=bytes; this.observations.push(value);
  }
  async call(id:string, invoke:(signal:AbortSignal)=>Promise<QlooCallRecord>):Promise<QlooCallRecord> {
    this.check(); const index=this.slots.findIndex(x=>x.id===id); const slot=this.slots[index];
    if (!slot || slot.status!=='not-run' || this.current!==null || this.slots.filter(x=>x.status!=='not-run').length>=this.limits.maxLogical) {this.abort('logical_cap');throw new BatchRefusal('logical_cap');}
    // Reserve the maximum allowed projection before scheduling another logical call.
    if (this.retained+65_536>this.limits.maxReportBytes-FINAL_RESERVE) {this.abort('output_cap');throw new BatchRefusal('output_cap');}
    slot.status='started'; this.current=index;
    try {
      const call=await abortable(invoke(this.signal),this.signal); this.check();
      if (!['/search','/v2/insights','/v2/tags'].includes(call.endpoint) || (call.origin!=='live' && call.origin!=='live-cache') || !/^[a-f0-9]{64}$/.test(call.responseSha256) || !Number.isInteger(call.httpStatus) || call.httpStatus<200 || call.httpStatus>=300 ||
          call.origin==='live-cache' && slot.attempts!==0 || call.origin==='live' && slot.attempts===0 || this.metadata.cache==='off' && call.origin==='live-cache') throw new BatchRefusal('response_schema');
      slot.origin=call.origin; slot.networkVerified=call.origin==='live' && slot.attempts>0;
      slot.receipt={endpoint:call.endpoint,status:call.httpStatus,responseSha256:call.responseSha256,requestedAt:boundedString(call.requestedAt,64),liveFetchedAt:boundedString(call.liveFetchedAt,64),rawResponseRetained:false};
      slot.status='completed'; return call;
    } catch(e) {
      slot.status=this.signal.aborted?'aborted':'failed'; slot.error=safeCode(e); this.fail(e); throw e;
    } finally {this.current=null;}
  }
  async pair(id:string,base:(signal:AbortSignal)=>Promise<QlooCallRecord>,variant:(signal:AbortSignal)=>Promise<QlooCallRecord>):Promise<[QlooCallRecord,QlooCallRecord]|null> {
    this.check();
    try {const a=await this.call(id+'a',base);const b=await this.call(id+'b',variant);return [a,b];}
    catch(e){if(this.signal.aborted || !this.canContinuePair())throw e;this.record({id,outcome:'error'});return null;}
  }
  fail(e:unknown) { if (!this.firstError) this.firstError=safeCode(e); if (this.policy!=='continue-on-pair-error' || this.signal.aborted || e instanceof BatchRefusal && ['logical_cap','transport_cap','output_cap','authorization','input'].includes(e.code)) this.stopped=true; }
  canContinuePair() {this.check();return this.policy==='continue-on-pair-error';}
  /** Count actual fetch entries, including failed entries. No URL, headers or error message retained. */
  meteredFetch(fetcher:typeof fetch):typeof fetch {
    return (async (input:RequestInfo|URL,init?:RequestInit)=>{
      this.check(); const index=this.current; const slot=index===null?undefined:this.slots[index];
      const signal=init?.signal ? AbortSignal.any([this.signal,init.signal]) : this.signal;signal.throwIfAborted();
      if (!slot || slot.attempts>=4 || this.attempts.length>=this.limits.maxFetch) {this.abort('transport_cap');throw new BatchRefusal('transport_cap');}
      slot.attempts++; const start=this.ports.now(); const attempt:Attempt={call:index!,number:slot.attempts,status:null,error:null,elapsedMs:0};this.attempts.push(attempt);
      try {
        const response=await abortable(fetcher(input,{...init,signal}),signal);
        attempt.status=response.status; this.check();
        return cancellableResponse(response,signal);
      } catch {attempt.error=signal.aborted?'aborted':'transport'; if (this.signal.aborted) throw this.signal.reason; throw new BatchRefusal('call_failed');}
      finally {attempt.elapsedMs=Math.max(0,this.ports.now()-start);}
    }) as typeof fetch;
  }
  async finish() {
    this.cancelTimer();
    const summary={version:1,...this.metadata,firstError:this.firstError,exitCode:this.firstError?1:0,elapsedMs:Math.max(0,this.ports.now()-this.startedAt),limits:this.limits,logical:this.slots,transport:this.attempts,observations:this.observations,exitCodeScope:'work result before report commit; outer receipt is authoritative',omissions:{rawResponses:true,queryParameters:true,retryCause:'not exposed by client',transportElapsedScope:'fetch entry to response headers or fetch error; excludes body and retry wait'},cleanupOwner:'separately granted runner; no host inventory claimed'};
    let text:string;try{text=boundedJson(summary,this.limits.maxReportBytes-1)+'\n';}catch{this.firstError??='output_cap';text=boundedJson({...summary,firstError:this.firstError,exitCode:1,observations:[],omissions:{...summary.omissions,observations:true,observationCount:this.observations.length}},FINAL_RESERVE-1)+'\n';}
    if (new TextEncoder().encode(text).length>this.limits.maxReportBytes) {this.reportWriteFailed=true;this.firstError??='output_cap';return;}
    // Reporting has its own bounded cooperative window and does not resurrect the work signal.
    const reportController=new AbortController();const cancel=this.ports.timer(this.limits.reportMs,()=>reportController.abort(new BatchRefusal('report_write')));
    try {await abortable(this.ports.atomicReport(text,reportController.signal),reportController.signal);this.reportWritten=true;}
    catch {this.reportWriteFailed=true;this.firstError??='report_write';}
    finally {cancel();}
  }
  dispose(){this.cancelTimer();}
}
export function boundedString(value:unknown,max=256):string|null {return typeof value==='string' && value.length<=max?value:null;}
export function entityRows(call:QlooCallRecord):any[] {const body=call.body as any;const rows=Array.isArray(body?.results)?body.results:body?.results?.entities;if(!Array.isArray(rows) || rows.length>50)throw new BatchRefusal('response_schema');return rows;}
export function observedEntities(call:QlooCallRecord) {
  return entityRows(call).map(e=>({id:boundedString(e.entity_id??e.id),name:boundedString(e.name,512),affinity:typeof e.query?.affinity==='number' && Number.isFinite(e.query.affinity)?e.query.affinity:null}));
}
export async function abortable<T>(promise:Promise<T>, signal:AbortSignal):Promise<T> {
  // The producer may synchronously abort while returning an already-rejected promise.
  // Observe that promise even when the signal is already aborted: no detached rejection.
  if(signal.aborted){void promise.catch(()=>{});throw signal.reason;}let handler:()=>void=()=>{};
  const stop=new Promise<never>((_,reject)=>{handler=()=>reject(signal.reason);signal.addEventListener('abort',handler,{once:true});});
  try{return await Promise.race([promise,stop]);}finally{signal.removeEventListener('abort',handler);}
}
/** Native fetch body cancellation plus a bounded pending-read escape, using the existing fetch seam. */
function cancellableResponse(response:Response, signal:AbortSignal):Response {
  if (!response.body) return response;
  const reader=response.body.getReader(); let ended=false;
  const cancel=()=>{if(!ended){ended=true;void reader.cancel().catch(()=>{});}};
  const body=new ReadableStream<Uint8Array>({
    async pull(controller) {try{const next=await abortable(reader.read(),signal);if(next.done){ended=true;signal.removeEventListener('abort',cancel);reader.releaseLock();controller.close();}else controller.enqueue(next.value);}catch{cancel();signal.removeEventListener('abort',cancel);controller.error(new BatchRefusal('cancelled'));}},
    async cancel(){cancel();signal.removeEventListener('abort',cancel);},
  },{highWaterMark:0});
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

/** Incremental JSON budget: never stringify a complete upstream body or allocate an uncapped report. */
export function boundedJson(value:unknown,limit:number):string {
  const parts:string[]=[];let bytes=0,nodes=0;
  const add=(v:string)=>{bytes+=new TextEncoder().encode(v).length;if(bytes>limit)throw new BatchRefusal('output_cap');parts.push(v);};
  const visit=(v:unknown,depth:number)=>{
    if(++nodes>30_000 || depth>16)throw new BatchRefusal('output_cap');
    if(v===null || typeof v==='boolean'){add(String(v));return;}
    if(typeof v==='string'){if(v.length>limit)throw new BatchRefusal('output_cap');add(JSON.stringify(v));return;}
    if(typeof v==='number' && Number.isFinite(v)){add(String(v));return;}
    if(Array.isArray(v)){if(v.length>512)throw new BatchRefusal('output_cap');add('[');v.forEach((x,i)=>{if(i)add(',');visit(x,depth+1);});add(']');return;}
    if(v && typeof v==='object' && Object.getPrototypeOf(v)===Object.prototype){const keys=Object.keys(v);if(keys.length>64)throw new BatchRefusal('output_cap');add('{');let i=0;for(const k of keys){const x=(v as Record<string,unknown>)[k];if(x===undefined)continue;if(i++)add(',');if(k.length>128)throw new BatchRefusal('output_cap');add(JSON.stringify(k));add(':');visit(x,depth+1);}add('}');return;}
    throw new BatchRefusal('output_cap');
  };visit(value,0);return parts.join('');
}
