import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseEnv } from '../src/server/env';
import { HttpQlooClient } from '../src/qloo/http-client';
import { buildInsightsQuery, QlooParamError } from '../src/qloo/params';
import type { QlooCallRecord } from '../src/shared/types';
import { BatchRefusal, LiveBatch, authorize, entityRows, boundedJson, type ScriptKind, type ExpectedBinding, type Limits } from './live-batch-core';
export { entityRows as entities, observedEntities } from './live-batch-core';
export const CHECKOUT='/opt/example/workflow/projects/openerfit-wt/regression';
export const WORKFLOW=path.resolve(CHECKOUT,'../../..');
export const THREAD='synthetic-regression-id';
export const WORKER_SCRATCH=path.resolve(WORKFLOW,'../hackathon-qloo-gpt-worker-1-'+THREAD);
export const BRANCH='example/regression';
const LOADER=path.join(CHECKOUT,'scripts/live-entry-loader.mjs');
const NODE='/opt/example/node/24/bin/node';
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const string=z.string().min(1).max(2048);
const argv=z.array(string).min(2).max(32);
const limits=z.strictObject({workMs:z.number().int(),cleanupMs:z.number().int(),reportMs:z.number().int(),maxLogical:z.number().int(),maxFetch:z.number().int(),maxReportBytes:z.number().int()});
const filePin=z.strictObject({path:string,sha256:digest,bytes:z.number().int().min(1).max(2_000_000)});
const proposalSchema=z.strictObject({
  version:z.literal(1),purpose:z.literal('live'),loader:filePin,graphManifest:z.strictObject({path:string,sha256:digest,bytes:z.number().int().min(1).max(262_144)}),kind:z.enum(['smoke','coverage','probe']),owner:z.literal('example-regression'),threadId:z.literal(THREAD),checkout:z.literal(CHECKOUT),branch:z.literal(BRANCH),commit:z.string().regex(/^[a-f0-9]{40}$/),
  grantId:z.string().regex(/^heavy-qloo-[a-z0-9-]{1,128}$/),inputPath:string,inputSha256:digest,resultRoot:string,
  errorPolicy:z.enum(['stop-first-error','continue-on-pair-error']),cache:z.enum(['off','allowed']),baseUrl:z.literal('https://hackathon.api.qloo.com'),limits,
  entryArgv:argv,runner:z.strictObject({path:string,sha256:digest,argv}),runnerReviewed:z.literal(true),
  graph:z.array(filePin).min(1).max(512),graphSha256:digest,
});
const id=z.string().min(1).max(256).refine(v=>!/[\s,\x00-\x1f]/.test(v) && !/^(fx-|urn:tag:fixture:)/i.test(v));
const query=z.string().trim().min(1).max(120).refine(v=>!/[\x00-\x1f]/.test(v));
export const inputSchemas={
  smoke:z.strictObject({searchQuery:query,headlinerId:id,rosterIds:z.array(id).min(1).max(25)}),
  coverage:z.strictObject({artists:z.array(z.strictObject({name:query,segment:z.enum(['singapore','international'])})).length(20),headlinerIds:z.array(id).length(3)}).refine(v=>v.artists.filter(a=>a.segment==='singapore').length===10),
  probe:z.strictObject({headlinerA:id,headlinerB:id,rosterIds:z.array(id).min(3).max(25),excludeBrandId:id,tagId:id}),
};
export type Inputs={ [K in ScriptKind]:z.infer<(typeof inputSchemas)[K]> };
/** Pure preclient validation, including N1. Exact strict schemas reject credential fields. */
export function validateInput<K extends ScriptKind>(kind:K,value:unknown):Inputs[K] {
  let parsed:Inputs[K];try{parsed=inputSchemas[kind].parse(value) as Inputs[K];}catch{throw new BatchRefusal('input');}
  const text=JSON.stringify(parsed);
  if (/api[_-]?key|authorization|bearer\s|sk-[a-z0-9]{12}/i.test(text)) throw new BatchRefusal('input');
  if(kind==='probe') {
    const input=parsed as Inputs['probe'];let rejected=false;
    try{buildInsightsQuery({type:'urn:entity:place',interestEntityIds:[input.headlinerA],take:8,extra:[['filter.locaton','POINT(0 0)']]},{live:true});}catch(e){rejected=e instanceof QlooParamError && e.code==='undocumented' && e.param==='filter.locaton';}
    if(!rejected)throw new BatchRefusal('input');
  }
  return parsed;
}
export interface FilePort {
  read(file:string,maxBytes:number,privateMode?:boolean):Promise<Uint8Array>;
  freshRoot(root:string):Promise<void>;
  writeAtomic(root:string,text:string,signal:AbortSignal):Promise<void>;
}
/** Primitive seam for the production read algorithm; injected checks never open a real file. */
export type ReadMetadata=Pick<Stats,'dev'|'ino'|'size'|'mode'|'uid'|'gid'|'mtimeMs'|'ctimeMs'|'isFile'|'isDirectory'|'isSymbolicLink'>;
export interface ReadHandle {
  stat():Promise<ReadMetadata>;
  read(buffer:Uint8Array,offset:number,length:number,position:number|null):Promise<{bytesRead:number}>;
  close():Promise<void>;
}
export interface ReadPrimitives {
  lstat(file:string):Promise<ReadMetadata>;
  realpath(file:string):Promise<string>;
  open(file:string,flags:number):Promise<ReadHandle>;
  ownerUid():number|undefined;
}
const readPrimitives:ReadPrimitives={lstat,realpath,open,ownerUid:()=>process.getuid?.()};
/** Every path component must be canonical and non-symlink. This is not a complete race proof. */
async function canonical(file:string,fs:Pick<ReadPrimitives,'lstat'|'realpath'>=readPrimitives):Promise<ReadMetadata> {
  if(!path.isAbsolute(file) || path.normalize(file)!==file)throw new BatchRefusal('input');
  let current=path.parse(file).root;let last:ReadMetadata|undefined;
  for(const piece of file.slice(current.length).split('/')) {current=path.join(current,piece);last=await fs.lstat(current);if(last.isSymbolicLink())throw new BatchRefusal('input');}
  if(!last || await fs.realpath(file)!==file)throw new BatchRefusal('input');
  return last;
}
const READ_FIELDS=['dev','ino','size','mode','uid','gid','mtimeMs','ctimeMs'] as const;
type ReadSnapshot=Pick<ReadMetadata,(typeof READ_FIELDS)[number]>;
function snapshot(stat:ReadMetadata):ReadSnapshot {
  return {dev:stat.dev,ino:stat.ino,size:stat.size,mode:stat.mode,uid:stat.uid,gid:stat.gid,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs};
}
function stable(before:ReadSnapshot,after:ReadMetadata) {return READ_FIELDS.every(key=>before[key]===after[key]);}
function regular(stat:ReadMetadata,maxBytes:number,privateMode:boolean,owner:number|undefined) {
  if(!stat.isFile() || stat.isSymbolicLink() || !['dev','ino','size','mode','uid','gid'].every(key=>Number.isSafeInteger(stat[key as keyof ReadSnapshot]) && Number(stat[key as keyof ReadSnapshot])>=0) ||
    !Number.isFinite(stat.mtimeMs) || !Number.isFinite(stat.ctimeMs) || stat.size>maxBytes ||
    privateMode && (!Number.isSafeInteger(owner) || (stat.mode&0o7777)!==0o600 || stat.uid!==owner))throw new BatchRefusal('input');
}
function privateParent(stat:ReadMetadata,owner:number|undefined) {
  if(!stat.isDirectory() || stat.isSymbolicLink() || !Number.isSafeInteger(owner) || (stat.mode&0o7777)!==0o700 || stat.uid!==owner)throw new BatchRefusal('input');
}
/** Pre-open refusal, nonblocking/no-follow open, stable descriptor, cap+1 read, mandatory close. */
export async function readBoundedRegular(file:string,maxBytes:number,privateMode:boolean,fs:ReadPrimitives):Promise<Uint8Array> {
  if(!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>2_000_000)throw new BatchRefusal('input');
  const pre=await canonical(file,fs);const owner=privateMode?fs.ownerUid():undefined;
  regular(pre,maxBytes,privateMode,owner);const before=snapshot(pre);
  let parentBefore:ReadSnapshot|undefined;
  if(privateMode){const parent=await fs.lstat(path.dirname(file));privateParent(parent,owner);parentBefore=snapshot(parent);}
  // A final-component substitution cannot turn this open into a blocking FIFO open.
  const fd=await fs.open(file,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try {
    const opened=await fd.stat();regular(opened,maxBytes,privateMode,owner);
    if(!stable(before,opened))throw new BatchRefusal('input');
    const out=new Uint8Array(maxBytes+1);let size=0;
    while(size<=maxBytes){
      const requested=out.length-size;const read=await fd.read(out,size,requested,null);
      if(!Number.isSafeInteger(read.bytesRead) || read.bytesRead<0 || read.bytesRead>requested)throw new BatchRefusal('input');
      if(!read.bytesRead)break;size+=read.bytesRead;
    }
    if(size>maxBytes)throw new BatchRefusal('input');
    const after=await fd.stat();regular(after,maxBytes,privateMode,owner);
    if(size!==before.size || !stable(before,after))throw new BatchRefusal('input');
    if(parentBefore){const parent=await fs.lstat(path.dirname(file));privateParent(parent,owner);
      if(!(['dev','ino','mode','uid','gid'] as const).every(key=>parentBefore![key]===parent[key]))throw new BatchRefusal('input');}
    return out.slice(0,size);
  } finally {await fd.close();} // A close failure must not be converted into success.
}
export const files:FilePort={
  read:(file,maxBytes,privateMode=false)=>readBoundedRegular(file,maxBytes,privateMode,readPrimitives),
  async freshRoot(root){await canonical(path.dirname(root));await mkdir(root,{mode:0o700});await canonical(root);if(((await lstat(root)).mode&0o777)!==0o700)throw new BatchRefusal('input');},
  async writeAtomic(root,text,signal){
    await canonical(root);if(((await lstat(root)).mode&0o777)!==0o700)throw new BatchRefusal('input');signal.throwIfAborted();
    const temp=path.join(root,'report.partial.tmp');const target=path.join(root,'report.json');let created=false;
    try{const fd=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);created=true;
      try{signal.throwIfAborted();await fd.writeFile(text);await fd.sync();signal.throwIfAborted();}finally{await fd.close();}
      signal.throwIfAborted();await rename(temp,target);created=false;
    }finally{if(created)await unlink(temp).catch(()=>{});}
  },
};
const decode=(v:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(v);
export interface SetupPorts {
  files:FilePort; cwd:string; entry:string[];
  createClient(options:{cache:'off'|'allowed';baseUrl:string;fetch:typeof fetch;inputText:string;validatedInput:Inputs[ScriptKind]}):Client;
  fetch:typeof fetch;
}
export type Client=Pick<HttpQlooClient,'search'|'insights'|'probeInsights'>;
export interface LiveSession<K extends ScriptKind> {batch:LiveBatch;input:Inputs[K];client:Client}
/** No key read or client construction before every selected grant/input/source check succeeds. */
export async function prepare<K extends ScriptKind>(kind:K,batch:LiveBatch,ports:SetupPorts,proposalPath:string,grantId:string):Promise<LiveSession<K>> {
  batch.check();if(!proposalPath.startsWith(WORKER_SCRATCH+'/') || path.normalize(proposalPath)!==proposalPath || ports.cwd!==CHECKOUT)throw new BatchRefusal('authorization');
  const proposalBytes=await ports.files.read(proposalPath,65_536,true);batch.check();
  let p:z.infer<typeof proposalSchema>;try{p=proposalSchema.parse(JSON.parse(decode(proposalBytes)));}catch{throw new BatchRefusal('authorization');}
  if(p.kind!==kind || p.grantId!==grantId || p.loader.path!==LOADER || !p.graphManifest.path.startsWith(WORKER_SCRATCH+'/'))throw new BatchRefusal('authorization');
  const expectedEntry=[NODE,'--import',LOADER,path.join(CHECKOUT,`scripts/qloo-${kind}.ts`),'--proposal',proposalPath,'--grant',grantId];
  // Independent fixed executable/loader/script/flag roles, never a substring match.
  if(JSON.stringify(ports.entry)!==JSON.stringify(expectedEntry) || JSON.stringify(p.entryArgv)!==JSON.stringify(expectedEntry) ||
    !proposalPath.startsWith(WORKER_SCRATCH+'/') || !p.inputPath.startsWith(WORKER_SCRATCH+'/') || !p.resultRoot.startsWith(WORKER_SCRATCH+'/'))throw new BatchRefusal('authorization');
  if(!p.runner.path.startsWith(WORKFLOW+'/') || !p.runner.argv.includes(p.runner.path) || p.runner.argv.at(-1)!==grantId)throw new BatchRefusal('authorization');
  const expected:ExpectedBinding={grantId,owner:p.owner,threadId:p.threadId,checkout:p.checkout,branch:p.branch,commit:p.commit,proposalSha256:hash(proposalBytes),inputSha256:p.inputSha256,commands:[p.runner.argv],actualEntry:ports.entry,limits:p.limits,
    liveBatch:{kind,errorPolicy:p.errorPolicy,cache:p.cache,inputSha256:p.inputSha256,inputPath:p.inputPath,resultRoot:p.resultRoot,graphSha256:p.graphSha256,runner:p.runner,entryArgv:p.entryArgv,runnerReviewed:true,baseUrl:p.baseUrl}};
  const reservation=JSON.parse(decode(await ports.files.read(path.join(WORKFLOW,'control/heavy-task-reservation.json'),65_536)));
  if(reservation.status!=='active')throw new BatchRefusal('authorization');authorize(reservation.active,expected);
  const activeEntry=reservation.active.liveBatch;
  if(activeEntry.purpose!==p.purpose)throw new BatchRefusal('authorization');
  for(const key of ['path','sha256','bytes'] as const)if(activeEntry.loader?.[key]!==p.loader[key] || activeEntry.graphManifest?.[key]!==p.graphManifest[key])throw new BatchRefusal('authorization');
  batch.configure(kind,p.limits as Limits,p.errorPolicy,p.cache,grantId);batch.check();
  const gitDir=path.join(WORKFLOW,'projects/qloo/.git');
  const worktreeMarker=decode(await ports.files.read(path.join(CHECKOUT,'.git'),512));
  const head=decode(await ports.files.read(path.join(gitDir,'worktrees/regression/HEAD'),128));
  const ref=decode(await ports.files.read(path.join(gitDir,`refs/heads/${BRANCH}`),128));
  if(worktreeMarker!==`gitdir: ${gitDir}/worktrees/regression\n` || head!==`ref: refs/heads/${BRANCH}\n` || ref!==p.commit+'\n')throw new BatchRefusal('authorization');
  if(hash(JSON.stringify(p.graph.map(pin=>[pin.path,pin.bytes,pin.sha256])))!==p.graphSha256 || new Set(p.graph.map(f=>f.path)).size!==p.graph.length)throw new BatchRefusal('authorization');
  const required=[`scripts/qloo-${kind}.ts`,'scripts/live-common.ts','scripts/live-batch-core.ts','src/qloo/http-client.ts','scripts/live-entry-loader.mjs'];
  if(required.some(f=>!p.graph.some(pin=>pin.path===path.join(CHECKOUT,f))))throw new BatchRefusal('authorization');
  const loaderPin=p.graph.find(pin=>pin.path===LOADER);
  if(!loaderPin || loaderPin.bytes!==p.loader.bytes || loaderPin.sha256!==p.loader.sha256)throw new BatchRefusal('authorization');
  const manifestBytes=await ports.files.read(p.graphManifest.path,p.graphManifest.bytes);batch.check();
  if(manifestBytes.length!==p.graphManifest.bytes || hash(manifestBytes)!==p.graphManifest.sha256)throw new BatchRefusal('authorization');
  const manifest=JSON.parse(decode(manifestBytes));
  if(manifest.state!=='REVIEWED' || manifest.grammarProven!==true || manifest.initializersReviewed!==true || manifest.generatedCodeReviewed!==true || manifest.blockers?.length || manifest.sourceCommit!==p.commit || manifest.fullSourceTupleSha256!==p.graphSha256)throw new BatchRefusal('authorization');
  let graphBytes=0;
  for(const pin of [...p.graph,{path:p.runner.path,sha256:p.runner.sha256,bytes:2_000_000}]) {
    batch.check();if(pin.path!==p.runner.path && !pin.path.startsWith(CHECKOUT+'/'))throw new BatchRefusal('authorization');
    const bytes=await ports.files.read(pin.path,pin.bytes);graphBytes+=bytes.length;
    if(graphBytes>32*1024*1024 || pin.path!==p.runner.path && bytes.length!==pin.bytes || hash(bytes)!==pin.sha256)throw new BatchRefusal('authorization');
  }
  batch.check();const inputBytes=await ports.files.read(p.inputPath,65_536,true);batch.check();
  if(hash(inputBytes)!==p.inputSha256)throw new BatchRefusal('authorization');
  let input:Inputs[K];try{input=validateInput(kind,JSON.parse(decode(inputBytes)));}catch{throw new BatchRefusal('input');}
  await ports.files.freshRoot(p.resultRoot);batch.check();
  // The reporting root is activated only after grant/source/input validation, before keyed setup.
  (batch as LiveBatch & {resultRoot?:string}).resultRoot=p.resultRoot;
  batch.plan(kind==='smoke'?['S1','S2']:kind==='coverage'?Array.from({length:25},(_,i)=>`C${i+1}`):Array.from({length:8},(_,i)=>[`P${i+1}a`,`P${i+1}b`]).flat());
  if(kind==='probe')batch.record({n1:{rejectedLocally:true,keyAndClientIndependent:true}});
  const client=ports.createClient({cache:p.cache,baseUrl:p.baseUrl,fetch:batch.meteredFetch(ports.fetch),inputText:decode(inputBytes),validatedInput:input});batch.check();
  return {batch,input,client};
}
export const entityId=(e:any):string=>typeof e?.entity_id==='string'?e.entity_id:typeof e?.id==='string'?e.id:'';
export const ids=(call:QlooCallRecord)=>entityRows(call).map(entityId).filter(Boolean);
/** Protected literal forms in raw JSON, bounded canonical data and already validated string leaves. */
export function guardedClient<T>(credential:string,inputText:string,validatedInput:Inputs[ScriptKind],construct:()=>T):T {
  if(!credential || new TextEncoder().encode(inputText).length>65_536)throw new BatchRefusal('input');
  let canonicalInput:string;try{canonicalInput=boundedJson(validatedInput,65_536);}catch{throw new BatchRefusal('input');}
  const forms=[credential,encodeURIComponent(credential),JSON.stringify(credential).slice(1,-1)];
  const contains=(text:string)=>forms.some(form=>text.includes(form));
  const protectedLeaf=(value:unknown):boolean=>typeof value==='string'?contains(value):Array.isArray(value)?value.some(protectedLeaf):
    value!==null && typeof value==='object'?Object.values(value).some(protectedLeaf):false;
  if(contains(inputText) || contains(canonicalInput) || protectedLeaf(validatedInput))throw new BatchRefusal('input');
  return construct();
}
/** Real entry is dormant until invoked under a new reviewed finite-runner grant. */
export async function runLive<K extends ScriptKind>(kind:K,fn:(session:LiveSession<K>)=>Promise<void>) {
  let batch:LiveBatch;batch=new LiveBatch({now:()=>performance.now(),timer:(ms,cb)=>{const h=setTimeout(cb,ms);h.unref();return()=>clearTimeout(h);},
    atomicReport:async(text,signal)=>{const root=(batch as LiveBatch & {resultRoot?:string}).resultRoot;if(!root)throw new BatchRefusal('report_write');await files.writeAtomic(root,text,signal);}});
  const stop=()=>batch.abort('cancelled');process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const args=process.argv.slice(2);if(args.length!==4 || args[0]!=='--proposal' || args[2]!=='--grant')throw new BatchRefusal('authorization');
    const session=await prepare(kind,batch,{files,cwd:process.cwd(),entry:[process.execPath,...process.execArgv,...process.argv.slice(1)],fetch:globalThis.fetch,
      createClient:({cache,baseUrl,fetch,inputText,validatedInput})=>{const env=parseEnv();if(env.qloo.mode!=='live' || !env.qloo.apiKey || env.qloo.baseUrl!==baseUrl || env.qloo.cacheEnabled!==(cache==='allowed'))throw new BatchRefusal('input');return guardedClient(env.qloo.apiKey,inputText,validatedInput,()=>new HttpQlooClient(env.qloo,{fetch}));}},args[1],args[3]);
    await fn(session);
  }catch(e){batch.fail(e);}
  finally{await batch.finish();batch.dispose();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  process.exitCode=batch.firstError || batch.reportWriteFailed?1:0;
  console.log(JSON.stringify({kind,exitCode:process.exitCode,firstError:batch.firstError,reportWritten:batch.reportWritten,reportWriteFailed:batch.reportWriteFailed,logical:batch.slots.length,fetchEntries:batch.attempts.length}));
}
