import { describe,it,expect,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { LiveBatch,BatchRefusal,authorize,abortable,CEILINGS,FINAL_RESERVE,boundedJson,type Limits,type ExpectedBinding } from '../../scripts/live-batch-core';
import { prepare,validateInput,readBoundedRegular,guardedClient,type ReadMetadata,type SetupPorts,CHECKOUT,WORKFLOW,WORKER_SCRATCH,THREAD,BRANCH,type FilePort } from '../../scripts/live-common';
import type { QlooCallRecord } from '../../src/shared/types';
const sha=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const limits:Limits={workMs:100,cleanupMs:20,reportMs:10,maxLogical:16,maxFetch:64,maxReportBytes:8*1024*1024};
function clock(){let time=0;let i=0;const timers=new Map<number,{at:number,fn:()=>void}>();return {now:()=>time,timer:(ms:number,fn:()=>void)=>{const id=++i;timers.set(id,{at:time+ms,fn});return()=>{timers.delete(id);};},advance:(ms:number)=>{time+=ms;for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.fn();}},pending:()=>timers.size};}
function harness(kind:'smoke'|'coverage'|'probe'='probe',policy:'stop-first-error'|'continue-on-pair-error'='stop-first-error',cache:'off'|'allowed'='off',overrides:Partial<Limits>={}){
 const c=clock();const reports:string[]=[];const writer=vi.fn(async(text:string)=>{reports.push(text);});
 const b=new LiveBatch({...c,atomicReport:writer});b.configure(kind,{...limits,maxLogical:CEILINGS[kind].logical,maxFetch:CEILINGS[kind].fetch,...overrides},policy,cache,'heavy-qloo-fake');return {b,c,reports,writer};
}
const record=(origin:'live'|'live-cache'='live'):QlooCallRecord=>({callId:'private',endpoint:'/v2/insights',params:[],canonicalUrl:'private',origin,fixtureLabel:null,httpStatus:200,durationMs:1,requestedAt:'2026-10-19',liveFetchedAt:'2026-10-19',responseSha256:'a'.repeat(64),body:{results:[]},paramWarnings:[]});
const response=(status=200)=>new Response(null,{status});
function binding():ExpectedBinding{return {grantId:'heavy-qloo-fake',owner:'example-regression',threadId:THREAD,checkout:CHECKOUT,branch:BRANCH,commit:'a'.repeat(40),proposalSha256:'b'.repeat(64),inputSha256:'c'.repeat(64),commands:[['python','runner','heavy-qloo-fake']],actualEntry:['node','script'],limits,
 liveBatch:{kind:'probe',errorPolicy:'stop-first-error',cache:'off',inputSha256:'c'.repeat(64),inputPath:'/private/input',resultRoot:'/private/result',graphSha256:'d'.repeat(64),runner:{path:'runner',sha256:'e'.repeat(64),argv:['python','runner','heavy-qloo-fake']},entryArgv:['node','script'],runnerReviewed:true,baseUrl:'https://hackathon.api.qloo.com'}};}
function setupFixture(){
 const h=harness();const input={searchQuery:'Example',headlinerId:'real-a',rosterIds:['real-b']};const ppath=WORKER_SCRATCH+'/fake/proposal.json';const grant='heavy-qloo-fake';
 const entry=['/opt/example/node/24/bin/node','--import',CHECKOUT+'/scripts/live-entry-loader.mjs',CHECKOUT+'/scripts/qloo-smoke.ts','--proposal',ppath,'--grant',grant];
 const graph=['scripts/qloo-smoke.ts','scripts/live-common.ts','scripts/live-batch-core.ts','src/qloo/http-client.ts','scripts/live-entry-loader.mjs'].map(file=>({path:CHECKOUT+'/'+file,bytes:1,sha256:sha('x')}));
 const graphText=JSON.stringify({state:'REVIEWED',grammarProven:true,initializersReviewed:true,generatedCodeReviewed:true,blockers:[],sourceCommit:'a'.repeat(40),fullSourceTupleSha256:sha(JSON.stringify(graph.map(pin=>[pin.path,pin.bytes,pin.sha256])))});
 const loader={path:CHECKOUT+'/scripts/live-entry-loader.mjs',sha256:sha('x'),bytes:1};
 const graphManifest={path:WORKER_SCRATCH+'/fake/graph.json',sha256:sha(graphText),bytes:new TextEncoder().encode(graphText).length};
 const p={version:1,purpose:'live',loader,graphManifest,kind:'smoke',owner:'example-regression',threadId:THREAD,checkout:CHECKOUT,branch:BRANCH,commit:'a'.repeat(40),grantId:grant,inputPath:WORKER_SCRATCH+'/fake/input.json',inputSha256:sha(JSON.stringify(input)),resultRoot:WORKER_SCRATCH+'/fake/results',errorPolicy:'stop-first-error',cache:'off',baseUrl:'https://hackathon.api.qloo.com',limits:{...limits,maxLogical:2,maxFetch:8},entryArgv:entry,runner:{path:WORKFLOW+'/control/future-runner.py',sha256:sha('runner'),argv:['python',WORKFLOW+'/control/future-runner.py',grant]},runnerReviewed:true,graph,graphSha256:sha(JSON.stringify(graph.map(pin=>[pin.path,pin.bytes,pin.sha256])))};
 const text=JSON.stringify(p);const active={grantId:grant,owner:p.owner,threadId:THREAD,checkout:CHECKOUT,branch:BRANCH,commit:p.commit,proposalSha256:sha(text),inputSha256:p.inputSha256,commands:[p.runner.argv],limits:p.limits,liveBatch:{purpose:p.purpose,loader:p.loader,graphManifest:p.graphManifest,kind:p.kind,errorPolicy:p.errorPolicy,cache:p.cache,inputSha256:p.inputSha256,inputPath:p.inputPath,resultRoot:p.resultRoot,graphSha256:p.graphSha256,runner:p.runner,entryArgv:entry,runnerReviewed:true,baseUrl:p.baseUrl},extra:'safe additive metadata'};
 const map=new Map<string,string>([[ppath,text],[p.graphManifest.path,graphText],[p.inputPath,JSON.stringify(input)],[WORKFLOW+'/control/heavy-task-reservation.json',JSON.stringify({status:'active',active})],[CHECKOUT+'/.git',`gitdir: ${WORKFLOW}/projects/qloo/.git/worktrees/regression\n`],[WORKFLOW+'/projects/qloo/.git/worktrees/regression/HEAD',`ref: refs/heads/${BRANCH}\n`],[WORKFLOW+'/projects/qloo/.git/refs/heads/'+BRANCH,p.commit+'\n'],[p.runner.path,'runner'],...graph.map(pin=>[pin.path,'x'] as [string,string])]);
 const read=vi.fn(async(file:string,max:number)=>{const v=map.get(file);if(v===undefined || new TextEncoder().encode(v).length>max)throw new BatchRefusal('input');return new TextEncoder().encode(v);});
 const fs:FilePort={read,freshRoot:vi.fn(async()=>{}),writeAtomic:vi.fn(async()=>{})};
 const client={search:vi.fn(),insights:vi.fn(),probeInsights:vi.fn()};const createClient=vi.fn((_options:Parameters<SetupPorts['createClient']>[0])=>client);const fetch=vi.fn();
 return {...h,p,ppath,grant,entry,map,active,fs,read,client,createClient,ports:{files:fs,cwd:CHECKOUT,entry,createClient,fetch:fetch as typeof globalThis.fetch}};
}
describe('finite live batch, injected adapters only',()=>{
 it('N1 and strict inputs validate without key, client, FS or network',()=>{
  expect(validateInput('probe',{headlinerA:'real-a',headlinerB:'real-b',rosterIds:['r1','r2','r3'],excludeBrandId:'brand',tagId:'tag'}).tagId).toBe('tag');
  for(const value of [{searchQuery:'x',headlinerId:'fx-art',rosterIds:['real']},{searchQuery:'x',headlinerId:'real',rosterIds:['urn:tag:fixture:x']},{searchQuery:'x',headlinerId:'real',rosterIds:['real'],apiKey:'secret'}])expect(()=>validateInput('smoke',value)).toThrow(BatchRefusal);
 });
 it('compares selected grant fields, exact argv and runner binding, permits additive metadata',()=>{
  const e=binding();expect(()=>authorize({...e,unrelated:'allowed'},e)).not.toThrow();
  for(const key of ['grantId','owner','threadId','checkout','branch','commit','proposalSha256','inputSha256'])expect(()=>authorize({...e,[key]:'wrong'},e)).toThrow(BatchRefusal);
  expect(()=>authorize({...e,commands:[['node','other-command']]},e)).toThrow(BatchRefusal);
  expect(()=>authorize({...e,liveBatch:{...e.liveBatch,entryArgv:['node','other']}},e)).toThrow(BatchRefusal);
 });
 it('prepares only after exact frozen source, input, private-file adapter and grant checks',async()=>{
  const x=setupFixture();await prepare('smoke',x.b,x.ports,x.ppath,x.grant);expect(x.createClient).toHaveBeenCalledTimes(1);expect(x.fs.freshRoot).toHaveBeenCalledWith(x.p.resultRoot);expect(x.read.mock.calls.every(c=>c[1]<=2_000_000)).toBe(true);x.b.dispose();
 });
 it('mismatched grants and input hashes refuse before client or result creation',async()=>{
  for(const which of ['grant','input','graph','entry']){
   const x=setupFixture();if(which==='grant')x.map.set(WORKFLOW+'/control/heavy-task-reservation.json',JSON.stringify({status:'active',active:{...x.active,commit:'bad'}}));
   if(which==='input')x.map.set(x.p.inputPath,'{}');if(which==='graph')x.map.set(x.p.graph[0].path,'z');if(which==='entry')x.ports.entry=[...x.entry.slice(0,-1),'wrong'];
   await expect(prepare('smoke',x.b,x.ports,x.ppath,x.grant)).rejects.toBeInstanceOf(BatchRefusal);expect(x.createClient).not.toHaveBeenCalled();expect(x.fs.freshRoot).not.toHaveBeenCalled();x.b.dispose();
  }
 });
 it('private/oversized input refusal from fake file adapter occurs before client',async()=>{
  const x=setupFixture();x.read.mockImplementation(async(file,max)=>{if(file===x.p.inputPath)throw new BatchRefusal('input');const v=x.map.get(file)!;if(v.length>max)throw new BatchRefusal('input');return new TextEncoder().encode(v);});
  await expect(prepare('smoke',x.b,x.ports,x.ppath,x.grant)).rejects.toBeInstanceOf(BatchRefusal);expect(x.createClient).not.toHaveBeenCalled();x.b.dispose();
 });
 it('expires from the original pre-setup clock, never resets the work budget',async()=>{
  const x=setupFixture();x.c.advance(101);await expect(prepare('smoke',x.b,x.ports,x.ppath,x.grant)).rejects.toBeInstanceOf(BatchRefusal);expect(x.createClient).not.toHaveBeenCalled();x.b.dispose();
 });
 it('aborts an unreturned fetch and retains failed-entry accounting with sanitized output',async()=>{
  const {b,c,reports}=harness('smoke');b.plan(['S1','S2']);const underlying=vi.fn(()=>new Promise<Response>(()=>{}));const fetch=b.meteredFetch(underlying as typeof globalThis.fetch);
  const pending=b.call('S1',async signal=>{await fetch('private-url',{signal});return record();});await Promise.resolve();c.advance(100);await expect(pending).rejects.toBeInstanceOf(BatchRefusal);await b.finish();
  expect(underlying).toHaveBeenCalledTimes(1);expect(b.slots.map(s=>s.status)).toEqual(['aborted','not-run']);expect(b.attempts[0].error).toBe('aborted');expect(reports[0]).not.toContain('private-url');expect(c.pending()).toBe(0);
 });
 it('cancels a pending response body read through the fetch seam',async()=>{
  const {b,c}=harness('smoke');b.plan(['S1']);const cancel=vi.fn();const body=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{}),cancel});
  const fetch=b.meteredFetch(vi.fn(async()=>new Response(body)) as typeof globalThis.fetch);
  const pending=b.call('S1',async signal=>{const r=await fetch('private',{signal});const reader=r.body!.getReader();try{await reader.read();}finally{await reader.cancel().catch(()=>{});}return record();});
  for(let i=0;i<12;i++)await Promise.resolve();c.advance(100);await expect(pending).rejects.toBeInstanceOf(BatchRefusal);expect(cancel).toHaveBeenCalledTimes(1);expect(b.slots[0].status).toBe('aborted');b.dispose();
 });
 it('caller signal cancels an injected retry wait without scheduling another attempt',async()=>{
  const {b,c}=harness('smoke');b.plan(['S1','S2']);const raw=vi.fn(async()=>response(429));const fetch=b.meteredFetch(raw as typeof globalThis.fetch);const waiting=vi.fn();
  const pending=b.call('S1',async signal=>{await fetch('private',{signal});waiting();await abortable(new Promise<void>(()=>{}),signal);await fetch('private',{signal});return record();});
  for(let i=0;i<12;i++)await Promise.resolve();expect(waiting).toHaveBeenCalledOnce();c.advance(100);await expect(pending).rejects.toBeInstanceOf(BatchRefusal);expect(raw).toHaveBeenCalledTimes(1);b.dispose();
 });
 it.each(['smoke','coverage','probe'] as const)('enforces exact %s aggregate ceiling and four entries per logical call',async kind=>{
  const {b}=harness(kind);const cap=CEILINGS[kind];b.plan(Array.from({length:cap.logical},(_,i)=>`C${i+1}`));const raw=vi.fn(async()=>response());const fetch=b.meteredFetch(raw as typeof globalThis.fetch);
  for(let i=0;i<cap.logical;i++)await b.call(`C${i+1}`,async signal=>{for(let n=0;n<4;n++)await fetch('private',{signal});return record();});
  expect(raw).toHaveBeenCalledTimes(cap.fetch);expect(b.attempts.length).toBe(cap.fetch);b.dispose();
 });
 it('aborts before a fifth fetch despite a fake client swallowing transient errors',async()=>{
  const {b}=harness('smoke');b.plan(['S1','S2']);const raw=vi.fn(async()=>{throw new Error('secret response message');});const fetch=b.meteredFetch(raw as typeof globalThis.fetch);
  await expect(b.call('S1',async signal=>{for(let n=0;n<7;n++){try{await fetch('private',{signal});}catch{if(signal.aborted)throw signal.reason;}}return record();})).rejects.toMatchObject({code:'transport_cap'});
  expect(raw).toHaveBeenCalledTimes(4);expect(b.signal.aborted).toBe(true);expect(b.slots[1].status).toBe('not-run');b.dispose();
 });
 it('an explicitly smaller aggregate cap aborts before another physical entry',async()=>{
  const {b}=harness('probe','continue-on-pair-error','off',{maxFetch:1});b.plan(['P1a','P1b','P2a','P2b']);const raw=vi.fn(async()=>response());const fetch=b.meteredFetch(raw as typeof globalThis.fetch);
  const invoke=async(signal:AbortSignal)=>{await fetch('private',{signal});return record();};await expect(b.pair('P1',invoke,invoke)).rejects.toMatchObject({code:'transport_cap'});expect(raw).toHaveBeenCalledTimes(1);expect(b.slots.map(s=>s.status)).toEqual(['completed','aborted','not-run','not-run']);b.dispose();
 });
 it('stop-first-error leaves a failed base variant and later pairs not-run',async()=>{
  const {b,reports}=harness();b.plan(['P1a','P1b','P2a','P2b']);const variant=vi.fn();await expect(b.pair('P1',async()=>{throw new Error('sensitive');},variant)).rejects.toBeInstanceOf(BatchRefusal);await b.finish();expect(variant).not.toHaveBeenCalled();expect(b.slots.map(s=>s.status)).toEqual(['failed','not-run','not-run','not-run']);expect(JSON.parse(reports[0]).exitCode).toBe(1);expect(reports[0]).not.toContain('sensitive');
 });
 it('explicit continue-on-pair-error continues, retaining first error and failed-base not-run variant',async()=>{
  const {b,reports}=harness('probe','continue-on-pair-error','allowed');b.plan(['P1a','P1b','P2a','P2b']);const variant=vi.fn();expect(await b.pair('P1',async()=>{throw new Error('private');},variant)).toBeNull();
  expect(await b.pair('P2',async()=>record('live-cache'),async()=>record('live-cache'))).not.toBeNull();await b.finish();expect(variant).not.toHaveBeenCalled();expect(b.slots.map(s=>s.status)).toEqual(['failed','not-run','completed','completed']);expect(JSON.parse(reports[0]).firstError).toBe('call_failed');
 });
 it('expiry between pairs and explicit cancellation override continuation',async()=>{
  for(const mode of ['deadline','cancel']){const {b,c}=harness('probe','continue-on-pair-error','allowed');b.plan(['P1a','P1b','P2a','P2b']);await b.pair('P1',async()=>record('live-cache'),async()=>record('live-cache'));if(mode==='deadline')c.advance(100);else b.abort('cancelled');const next=vi.fn();await expect(b.pair('P2',next,next)).rejects.toBeInstanceOf(BatchRefusal);expect(next).not.toHaveBeenCalled();expect(b.slots[2].status).toBe('not-run');b.dispose();}
 });
 it('cache hits are zero-transport cache outcomes, and cache-off rejects substitution',async()=>{
  const {b}=harness('smoke','stop-first-error','allowed');b.plan(['S1']);await b.call('S1',async()=>record('live-cache'));expect(b.attempts).toHaveLength(0);expect(b.slots[0]).toMatchObject({origin:'live-cache',networkVerified:false,attempts:0});b.dispose();
  const off=harness('smoke');off.b.plan(['S1']);await expect(off.b.call('S1',async()=>record('live-cache'))).rejects.toMatchObject({code:'response_schema'});off.b.dispose();
 });
 it('output cap aborts scheduling and still writes a bounded partial with omissions',async()=>{
  const {b,reports}=harness('smoke');b.plan(['S1','S2']);expect(()=>b.record({secret:'x'.repeat(65_537)})).toThrow(BatchRefusal);const invoke=vi.fn();await expect(b.call('S1',invoke)).rejects.toMatchObject({code:'output_cap'});await b.finish();expect(invoke).not.toHaveBeenCalled();expect(reports[0].length).toBeLessThan(FINAL_RESERVE);expect(JSON.parse(reports[0]).omissions.rawResponses).toBe(true);
 });
 it('report failure preserves first error and marks failure, never publishes error text',async()=>{
  const {b,writer,c}=harness('smoke');b.fail(new Error('credential'));writer.mockRejectedValue(new Error('private path'));await b.finish();expect(b.firstError).toBe('call_failed');expect(b.reportWriteFailed).toBe(true);expect(b.reportWritten).toBe(false);expect(c.pending()).toBe(0);
 });
 it('bounded serialization rejects oversized/deep/unserializable objects',()=>{
  expect(()=>boundedJson({v:'x'.repeat(1000)},64)).toThrow(BatchRefusal);expect(()=>boundedJson(new Error('secret'),1000)).toThrow(BatchRefusal);expect(boundedJson({n:null,b:true},100)).toBe('{"n":null,"b":true}');
 });
});

// S5-D R1 DRAFT ONLY. Exercise the actual reader via fake primitives; no real FS/env/client.
type FileKind='file'|'directory'|'fifo'|'device'|'symlink';
function readMetadata(kind:FileKind='file',patch:Partial<ReadMetadata>={}):ReadMetadata {
 return {dev:1,ino:42,size:kind==='file'?3:0,mode:kind==='directory'?0o40700:kind==='fifo'?0o10600:kind==='device'?0o20600:kind==='symlink'?0o120600:0o100600,
  uid:502,gid:20,mtimeMs:1,ctimeMs:1,isFile:()=>kind==='file',isDirectory:()=>kind==='directory',isSymbolicLink:()=>kind==='symlink',...patch};
}
function readerFixture(kind:FileKind='file',patch:Partial<ReadMetadata>={},payload=new Uint8Array([1,2,3])) {
 const file='/private/fake/input.json';const before=readMetadata(kind,patch);const parent=readMetadata('directory');let offset=0;
 const fd={stat:vi.fn(async()=>before),read:vi.fn(async(buffer:Uint8Array,start:number,length:number,_position:number|null)=>{
  const piece=payload.slice(offset,offset+length);buffer.set(piece,start);offset+=piece.length;return {bytesRead:piece.length};
 }),close:vi.fn(async()=>{})};
 const fs={lstat:vi.fn(async(name:string)=>name===file?before:parent),realpath:vi.fn(async(name:string)=>name),open:vi.fn(async(_file:string,_flags:number)=>fd),ownerUid:vi.fn(()=>502)};
 return {file,before,parent,fd,fs};
}
function resealInput(x:ReturnType<typeof setupFixture>,raw:string) {
 x.map.set(x.p.inputPath,raw);x.p.inputSha256=sha(raw);x.active.inputSha256=x.p.inputSha256;x.active.liveBatch.inputSha256=x.p.inputSha256;
 const proposalText=JSON.stringify(x.p);x.map.set(x.ppath,proposalText);x.active.proposalSha256=sha(proposalText);
 x.map.set(WORKFLOW+'/control/heavy-task-reservation.json',JSON.stringify({status:'active',active:x.active}));
}
describe('S5-D R1 drafted reader and decoded-input regressions — unrun',()=>{
 it.each(['fifo','device','directory','symlink'] as const)('rejects known %s before any open',async kind=>{
  const x=readerFixture(kind);await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);
  expect(x.fs.open).not.toHaveBeenCalled();expect(x.fd.close).not.toHaveBeenCalled();
 });
 it.each(['relative.json','/private/fake/../input.json'])('rejects noncanonical path without opening',async file=>{
  const x=readerFixture();await expect(readBoundedRegular(file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);expect(x.fs.open).not.toHaveBeenCalled();
 });
 it.each(['size','mode','owner'] as const)('rejects pre-open private %s violation',async which=>{
  const x=readerFixture('file',which==='size'?{size:9}:which==='mode'?{mode:0o100644}:{uid:503});
  await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);expect(x.fs.open).not.toHaveBeenCalled();
 });
 it('opens a replaced special file only nonblocking/no-follow, refuses descriptor and closes',async()=>{
  const x=readerFixture();x.fd.stat.mockResolvedValueOnce(readMetadata('fifo'));
  await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);
  expect(x.fs.open).toHaveBeenCalledTimes(1);const flags=x.fs.open.mock.calls[0][1];
  expect(flags&constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);expect(flags&constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  expect(flags).toBe(constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);expect(x.fd.read).not.toHaveBeenCalled();expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it('rejects pre-open inode replacement even if a fake mutates its previous metadata object',async()=>{
  const x=readerFixture();x.fs.open.mockImplementation(async()=>{x.before.ino++;return x.fd;});
  await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);expect(x.fd.read).not.toHaveBeenCalled();expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it.each(['dev','ino','size','mode','uid','gid','mtimeMs','ctimeMs'] as const)('refuses descriptor %s instability after read and closes',async field=>{
  const x=readerFixture();x.fd.stat.mockResolvedValueOnce(x.before).mockResolvedValueOnce({...x.before,[field]:x.before[field]+1});
  await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it('reads stable bounded regular bytes and closes after the final descriptor check',async()=>{
  const x=readerFixture();const value=await readBoundedRegular(x.file,3,true,x.fs);
  expect([...value]).toEqual([1,2,3]);expect(x.fd.stat).toHaveBeenCalledTimes(2);expect(x.fd.read.mock.calls.map(c=>c[2])).toEqual([4,1]);expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it('detects cap+1 overflow without reading further and still closes',async()=>{
  const x=readerFixture('file',{},new Uint8Array([1,2,3,4]));await expect(readBoundedRegular(x.file,3,true,x.fs)).rejects.toBeInstanceOf(BatchRefusal);
  expect(x.fd.read).toHaveBeenCalledTimes(1);expect(x.fd.read.mock.calls[0][2]).toBe(4);expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it.each(['initial-stat','read','final-stat','close'] as const)('keeps %s failure failing and closes every opened handle',async phase=>{
  const x=readerFixture();const failure=new Error('synthetic adapter failure');
  if(phase==='initial-stat')x.fd.stat.mockRejectedValueOnce(failure);
  if(phase==='read')x.fd.read.mockRejectedValueOnce(failure);
  if(phase==='final-stat')x.fd.stat.mockResolvedValueOnce(x.before).mockRejectedValueOnce(failure);
  if(phase==='close')x.fd.close.mockRejectedValueOnce(failure);
  await expect(readBoundedRegular(x.file,8,true,x.fs)).rejects.toBe(failure);expect(x.fd.close).toHaveBeenCalledTimes(1);
 });
 it('rejects Unicode-escaped synthetic credential in parsed input before the injected constructor',async()=>{
  const x=setupFixture();const credential='ravenStone42';const construct=vi.fn(()=>x.client);
  const escaped=[...credential].map(char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const raw='{"searchQuery":"'+escaped+'","headlinerId":"real-a","rosterIds":["real-b"]}';
  expect(raw.includes(credential)).toBe(false);resealInput(x,raw);
  x.ports.createClient=vi.fn((options:Parameters<SetupPorts['createClient']>[0])=>guardedClient(credential,options.inputText,options.validatedInput,construct));
  try{await expect(prepare('smoke',x.b,x.ports,x.ppath,x.grant)).rejects.toMatchObject({code:'input'});expect(construct).not.toHaveBeenCalled();}finally{x.b.dispose();}
 });
 it.each(['plain','url','json'] as const)('rejects decoded synthetic %s form before constructor without printing values',kind=>{
  const credential='draft/"\\token42';const value=kind==='plain'?credential:kind==='url'?encodeURIComponent(credential):JSON.stringify(credential).slice(1,-1);
  const raw=JSON.stringify({searchQuery:value,headlinerId:'real-a',rosterIds:['real-b']});const parsed=validateInput('smoke',JSON.parse(raw));const construct=vi.fn(()=>({synthetic:true}));
  expect(()=>guardedClient(credential,raw,parsed,construct)).toThrow(BatchRefusal);expect(construct).not.toHaveBeenCalled();
 });
 it('checks raw input even when JSON last-value parsing removes the protected text',()=>{
  const credential='rawSynthetic42';const raw='{"searchQuery":"'+credential+'","searchQuery":"Ordinary act","headlinerId":"real-a","rosterIds":["real-b"]}';
  const parsed=validateInput('smoke',JSON.parse(raw));const construct=vi.fn(()=>({synthetic:true}));
  expect(parsed.searchQuery.includes(credential)).toBe(false);expect(()=>guardedClient(credential,raw,parsed,construct)).toThrow(BatchRefusal);expect(construct).not.toHaveBeenCalled();
 });
 it('allows ordinary nonsecret validated input through the same constructor seam exactly once',()=>{
  const raw=JSON.stringify({searchQuery:'Ordinary act',headlinerId:'real-a',rosterIds:['real-b']});const parsed=validateInput('smoke',JSON.parse(raw));
  const value={synthetic:true};const construct=vi.fn(()=>value);expect(guardedClient('absent-synthetic-token',raw,parsed,construct)===value).toBe(true);expect(construct).toHaveBeenCalledTimes(1);
 });
});
