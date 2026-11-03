import { expect,it } from 'vitest';
import { createApp,type ApplicationServices } from '../../src/server/app';
import { parseEnv } from '../../src/server/env';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import { RunStore,newRunId } from '../../src/server/run-store';
import { RateLimiter } from '../../src/server/rate-limit';
import { createApplicationServices } from '../../src/agent/services';
import { NoneLlmAdapter } from '../../src/agent/llm/adapter';
import { confirmations,deferred,request as scenarioRequest } from '../agent/helpers';
import { buildInsightsQuery } from '../../src/qloo/params';
import { callRecord } from '../../src/qloo/record';
import type { QlooClient } from '../../src/qloo/client';
import type { Receipt, Run } from '../../src/shared/types';
const client=new FixtureQlooClient();
const json=(body:unknown,headers:Record<string,string>={})=>({method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
it('S1: health has modes/boolean key presence and no credential/path/LLM userinfo/query exposure',async()=>{const {app}=createApp({env:parseEnv({QLOO_API_KEY:'SENTINEL-SECRET',LLM_API_KEY:'LLM-SECRET',LLM_BASE_URL:'https://user:password@example.com/v1?token=secret',QLOO_CACHE_DIR:'/private/path'}),client});const response=await app.request('/api/health');const text=await response.text(),body=JSON.parse(text);expect(body.qloo.mode).toBe('fixture');expect(body.qloo.keyPresent).toBe(true);for(const secret of ['SENTINEL-SECRET','LLM-SECRET','password','token=secret','/private/path'])expect(text).not.toContain(secret);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');});
it('S3: >64KB returns 413 before JSON parsing; cross-origin mutations rejected; unknown run 404',async()=>{const {app}=createApp({env:parseEnv({}),client});expect((await app.request('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(65537)})).status).toBe(413);expect((await app.request('/api/resolve',json({}, {origin:'https://evil.example'}))).status).toBe(403);expect((await app.request('/api/runs/missing')).status).toBe(404);});
it.each([
  ['trusted HTTPS termination',true,'https://openerfit.onrender.com',{'x-forwarded-proto':'https'},400],
  ['foreign origin',true,'https://evil.example',{'x-forwarded-proto':'https'},403],
  ['untrusted forwarded scheme',false,'https://openerfit.onrender.com',{'x-forwarded-proto':'https'},403],
  ['downgraded origin',true,'http://openerfit.onrender.com',{'x-forwarded-proto':'https'},403],
  ['final proxy scheme',true,'https://openerfit.onrender.com',{'x-forwarded-proto':'http, https'},400],
  ['spoofed scheme prefix',true,'https://openerfit.onrender.com',{'x-forwarded-proto':'https, http'},403],
  ['invalid forwarded scheme',true,'http://openerfit.onrender.com',{'x-forwarded-proto':'invalid'},403],
  ['forwarded host cannot change origin',true,'https://evil.example',{'x-forwarded-proto':'https','x-forwarded-host':'evil.example'},403],
  ['cross-site fetch metadata',true,'https://openerfit.onrender.com',{'x-forwarded-proto':'https','sec-fetch-site':'cross-site'},403],
  ['direct HTTP unchanged',false,'http://openerfit.onrender.com',{},400],
  ['trusted direct HTTP unchanged',true,'http://openerfit.onrender.com',{},400],
] as const)('S3 proxy origin: %s',async(_label,trustProxy,origin,headers,status)=>{
  const {app,runs}=createApp({env:parseEnv({TRUST_PROXY:trustProxy?'1':'0'}),client});
  try{
    const response=await app.request('http://openerfit.onrender.com/api/runs',json({}, {origin,...headers}));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(status===403?'cross_origin_rejected':'invalid_request');
  }finally{runs.close();}
});
it('S1 boundary: resolve/run execution explicitly unavailable without domain/agent services',async()=>{const {app}=createApp({env:parseEnv({}),client});const response=await app.request('/api/resolve',json({headlinerQuery:'Harbour Lights',roster:[{rowId:'r1',name:'Saltwater Static'}]}));expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('integration_unavailable');});
it('S4: token buckets permit six per-IP runs and sixty globally; fixture bypasses route limit',()=>{const limiter=new RateLimiter(()=>0);for(let i=0;i<6;i++)expect(limiter.allow('runs:ip',6)).toBe(true);expect(limiter.allow('runs:ip',6)).toBe(false);for(let i=0;i<60;i++)expect(limiter.allow('runs:global',60)).toBe(true);expect(limiter.allow('runs:global',60)).toBe(false);});
it('S5: exports gate completion; receipt route removes nested fields and caps cleaned bytes without altering receipt', async () => {
  const runs = new RunStore(), id = newRunId();
  const run: Run = {id, state:'queued', request:{} as any, resolutions:{} as any, options:{planner:'scripted',baseline:false}, steps:[], brief:null, baseline:null, diff:null, error:null, startedAt:new Date().toISOString(), finishedAt:null, qlooCallCount:0};
  runs.add(run);
  const receipt: Receipt = {
    id:'R-test-affinity', callId:'C-test', endpoint:'/v2/insights',
    params:[['filter.type','urn:entity:artist'],['take','7']],
    origin:'fixture', fixtureLabel:'synthetic fixture (hand-written)',
    valuePath:'results.entities[0].query.affinity', value:0.9127, rawValueText:'0.9127',
    entity:{id:'fx-art-ss',name:'Saltwater Static',subtype:'urn:entity:artist'},
    liveFetchedAt:null, requestedAt:'2026-10-18T00:00:00.000Z',
  };
  let evidence: unknown = {
    entity_id:'fx-art-ss', akas:['removed-root'],
    properties:{short_descriptions:['removed-nested'], address:'Fictional address', external:{large:'x'.repeat(5000)}},
    nested:[{akas:['removed-array'],keep:{external:'removed-deep',query:{affinity:0.9127}}}],
  };
  const services: ApplicationServices = {
    normalize:s=>s,
    resolve:async()=>{throw new Error('not used');},
    execute:async()=>{throw new Error('not used');},
    exportBrief:(_brief,format)=>format==='md'?'# test':'<p>test</p>',
    entityExcerpt:(runId,selected)=>{
      expect(runId).toBe(id);
      expect(selected).toEqual(receipt);
      return evidence;
    },
  };
  const {app} = createApp({env:parseEnv({}),client,runs,services});
  try {
    expect((await app.request(`/api/runs/${id}/export.md`)).status).toBe(409);
    runs.transition(id,'ranking'); runs.transition(id,'partners'); runs.transition(id,'writing');
    runs.complete(id,{brief:{receipts:[receipt]} as any,baseline:null,diff:null});
    expect((await app.request(`/api/runs/${id}/export.md`)).headers.get('content-type')).toContain('text/markdown');
    expect((await app.request(`/api/runs/${id}/export.html`)).headers.get('content-type')).toContain('text/html');

    const response = await app.request(`/api/runs/${id}/receipts/${receipt.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.receipt).toEqual(receipt);
    expect(body.entityExcerpt).toEqual({
      entity_id:'fx-art-ss', properties:{address:'Fictional address'},
      nested:[{keep:{query:{affinity:0.9127}}}],
    });
    // Count UTF-8 bytes after cleaning, rather than JS string characters.
    evidence = {keep:'界'.repeat(1500),external:'removed'};
    const oversized = await app.request(`/api/runs/${id}/receipts/${receipt.id}`);
    expect(oversized.status).toBe(200);
    expect(await oversized.json()).toEqual({receipt,entityExcerpt:null});
    expect((await app.request(`/api/runs/${id}/receipts/unknown`)).status).toBe(404);
  } finally { runs.close(); }
});


async function resolved(app:ReturnType<typeof createApp>['app'],input=scenarioRequest()){
  const response=await app.request('/api/resolve',json({headlinerQuery:input.headlinerQuery,roster:input.roster.map(({rowId,name})=>({rowId,name}))}));expect(response.status).toBe(200);const evidence=await response.json();
  return {input,evidence,body:{resolveId:evidence.resolveId,request:input,resolutions:confirmations(evidence),options:{planner:'scripted',baseline:true}}};
}
it('S2: real resolve → agent → SSE → done preserves all search/step receipts and terminal replay',async()=>{
  const env=parseEnv({});const fixture=new FixtureQlooClient(),original=fixture.insights.bind(fixture),release=deferred<void>();
  fixture.insights=async(args,signal)=>{if(args.type==='urn:entity:artist')await release.promise;return original(args,signal);};
  const {app,runs}=createApp({env,client:fixture,services:createApplicationServices(env,new NoneLlmAdapter())});
  try{const r=await resolved(app);expect(r.evidence).not.toHaveProperty('origins');expect(r.evidence).not.toHaveProperty('calls');expect(Object.keys(r.evidence).sort()).toEqual(['headliner','receipts','resolveId','roster']);
    const response=await app.request('/api/runs',json(r.body));expect(response.status).toBe(202);const {runId}=await response.json();
    const stream=await app.request(`/api/runs/${runId}/events`);release.resolve();const events=await stream.text();
    const rankingIndex=events.indexOf('"state":"ranking"'),firstStepIndex=events.indexOf('event: step'),lastStepIndex=events.lastIndexOf('event: step'),doneIndex=events.indexOf('event: done');
    expect(rankingIndex).toBeGreaterThanOrEqual(0);expect(firstStepIndex).toBeGreaterThanOrEqual(0);expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(rankingIndex).toBeLessThan(firstStepIndex);expect(doneIndex).toBeGreaterThan(lastStepIndex);
    const run=await (await app.request(`/api/runs/${runId}`)).json() as Run;expect(run.state).toBe('done');expect(run.brief?.ranking.recommendedRowIds).toEqual(['r1','r2','r5']);
    const ids=new Set(run.brief!.receipts.map(x=>x.id));for(const receipt of r.evidence.receipts)expect(ids.has(receipt.id)).toBe(true);for(const step of run.steps)for(const id of step.receiptIds)expect(ids.has(id)).toBe(true);
    const late=await (await app.request(`/api/runs/${runId}/events`)).text();expect(late).toContain('"state":"done"');expect(late).toContain('event: step');expect(late).toContain('event: done');
    const markdown=await app.request(`/api/runs/${runId}/export.md`);expect(markdown.status).toBe(200);expect(await markdown.text()).toContain('## Receipts appendix');
  }finally{release.resolve();runs.close();}
});
it('S3: duplicate normalized roster names reject via real domain normalizer before starting any run',async()=>{
  const env=parseEnv({});const {app,runs}=createApp({env,client:new FixtureQlooClient(),services:createApplicationServices(env,new NoneLlmAdapter())});
  try{const r=await resolved(app);r.body.request.roster[1].name='The Saltwater Static!';const response=await app.request('/api/runs',json(r.body));expect(response.status).toBe(400);expect((await response.json()).error.code).toBe('duplicate_roster_name');}finally{runs.close();}
});
it('S4: seventh live-mode run is rejected through real resolve/run services with synthetic nonfixture IDs',async()=>{
  const env=parseEnv({QLOO_MODE:'live',QLOO_API_KEY:'synthetic-unit-only',TRUST_PROXY:'1'});let seq=0;
  const testClient:QlooClient={mode:'live',search:async(args)=>callRecord('/search',[['query',args.query],['types','urn:entity:artist']],JSON.stringify({results:[{entity_id:args.query==='Headliner'?'test-h':'test-a',name:args.query,subtype:'urn:entity:artist'}]}),{origin:'live',status:200,durationMs:0,requestedAt:new Date(1000+seq++).toISOString(),liveFetchedAt:'2026-10-18T00:00:00.000Z',warnings:[]}),
    insights:async(args)=>callRecord('/v2/insights',buildInsightsQuery(args).params,'{"results":{"entities":[]}}',{origin:'live',status:200,durationMs:0,requestedAt:new Date(1000+seq++).toISOString(),liveFetchedAt:'2026-10-18T00:00:00.000Z',warnings:[]}),tags:async()=>{throw new Error('Unexpected tag call');}};
  const {app,runs}=createApp({env,client:testClient,services:createApplicationServices(env,new NoneLlmAdapter())});
  try{const input=scenarioRequest();input.headlinerQuery='Headliner';input.roster=[{rowId:'r1',name:'Opener',feeAmount:null,bookability:'unknown',notes:''}];
    const r=await resolved(app,input);for(let i=0;i<6;i++){const response=await app.request('/api/runs',json(r.body,{'cf-connecting-ip':'192.0.2.1'}));expect(response.status).toBe(202);const {runId}=await response.json();await (await app.request(`/api/runs/${runId}/events`)).text();expect((await (await app.request(`/api/runs/${runId}`)).json()).state).toBe('done');}
    const seventh=await app.request('/api/runs',json(r.body,{'cf-connecting-ip':'192.0.2.1'}));expect(seventh.status).toBe(429);expect((await seventh.json()).error.code).toBe('rate_limited');
  }finally{runs.close();}
});
it('v1.1: successful empty ranking reaches unscored DONE brief; internal empty-search origins never become browser input',async()=>{
  const env=parseEnv({}),fixture=new FixtureQlooClient(),search=fixture.search.bind(fixture),insights=fixture.insights.bind(fixture);
  fixture.search=async(args,signal)=>({...await search(args,signal),origin:args.query==='Echo Park Ferry'?'live-cache':'live',fixtureLabel:null,liveFetchedAt:'2026-10-17T00:00:00.000Z'});
  fixture.insights=(args,signal)=>args.type==='urn:entity:artist'?Promise.resolve(callRecord('/v2/insights',buildInsightsQuery(args).params,'{"results":{"entities":[]}}',{origin:'fixture',fixtureLabel:'synthetic empty affinity test',status:200,durationMs:0,requestedAt:'2026-10-18T00:00:00.000Z',liveFetchedAt:null,warnings:[]})):insights(args,signal);
  const {app,runs}=createApp({env,client:fixture,services:createApplicationServices(env,new NoneLlmAdapter())});
  try{const r=await resolved(app);expect(r.evidence).not.toHaveProperty('origins');expect(r.evidence.receipts.every((x:Receipt)=>x.origin==='live')).toBe(true);
    const forged=await app.request('/api/runs',json({...r.body,searchOrigins:['fixture']}));expect(forged.status).toBe(400);
    const response=await app.request('/api/runs',json(r.body));expect(response.status).toBe(202);const {runId}=await response.json();await (await app.request(`/api/runs/${runId}/events`)).text();
    const run=await (await app.request(`/api/runs/${runId}`)).json() as Run;expect(run.state).toBe('done');expect(run.brief?.ranking.rows.filter(r=>r.status==='no_affinity_returned')).toHaveLength(7);expect(run.brief?.ranking.recommendedRowIds).toEqual([]);expect(run.brief?.origins).toEqual(expect.arrayContaining(['live','live-cache','fixture']));expect(run.brief?.claims.some(c=>c.section==='openers')).toBe(false);
  }finally{runs.close();}
});

it('Render visitor: stable edge IP survives rotating forwarded hops and forged alternative headers',async()=>{
  const env=parseEnv({QLOO_MODE:'live',QLOO_API_KEY:'synthetic-unit-only',TRUST_PROXY:'1'});
  const {app,runs}=createApp({env,client,now:()=>0});
  const body={headlinerQuery:'Headliner',roster:[{rowId:'r1',name:'Opener'}]};
  try {
    for(let i=0;i<20;i++)expect((await app.request('/api/resolve',json(body,{'cf-connecting-ip':'192.0.2.1','x-forwarded-for':`198.51.100.${i}, 10.0.0.${i}`}))).status).toBe(503);
    const blocked=await app.request('/api/resolve',json(body,{'cf-connecting-ip':'192.0.2.1','x-forwarded-for':'203.0.113.9','x-real-ip':'203.0.113.10','true-client-ip':'203.0.113.11'}));
    expect(blocked.status).toBe(429);expect((await blocked.json()).error.code).toBe('rate_limited');
    expect((await app.request('/api/resolve',json(body,{'cf-connecting-ip':'192.0.2.2','x-forwarded-for':'203.0.113.9'}))).status).toBe(503);
  } finally {runs.close();}
});
it.each([
  ['missing/invalid headers share a closed bucket',[undefined,'','not-an-ip','192.0.2.1, 192.0.2.2','192.0.2.1:9000','fe80::1%en0'],'not-an-ip','192.0.2.2'],
  ['IPv6 addresses share their canonical /64',['2001:db8:abcd:12::1','2001:0DB8:ABCD:0012:1234:0000:0000:0002'],'2001:db8:abcd:12:ffff::3','2001:db8:abcd:13::1'],
  ['IPv4-mapped IPv6 shares the plain IPv4 bucket',['192.0.2.1','::ffff:192.0.2.1','::FFFF:C000:0201'],'192.0.2.1','::ffff:192.0.2.2'],
] as const)('Render visitor: %s',async(_label,addresses,blockedAddress,otherAddress)=>{
  const env=parseEnv({QLOO_MODE:'live',QLOO_API_KEY:'synthetic-unit-only',TRUST_PROXY:'1'});
  const {app,runs}=createApp({env,client,now:()=>0});
  const body={headlinerQuery:'Headliner',roster:[{rowId:'r1',name:'Opener'}]};
  const headers=(ip:string|undefined):Record<string,string>=>ip===undefined?{}:{'cf-connecting-ip':ip};
  try{
    for(let i=0;i<20;i++)expect((await app.request('/api/resolve',json(body,headers(addresses[i%addresses.length])))).status).toBe(503);
    expect((await app.request('/api/resolve',json(body,headers(blockedAddress)))).status).toBe(429);
    expect((await app.request('/api/resolve',json(body,headers(otherAddress)))).status).toBe(503);
  }finally{runs.close();}
});
it('Render visitor: untrusted mode ignores all edge IP headers',async()=>{
  const env=parseEnv({QLOO_MODE:'live',QLOO_API_KEY:'synthetic-unit-only',TRUST_PROXY:'0'});
  const {app,runs}=createApp({env,client,now:()=>0});
  const body={headlinerQuery:'Headliner',roster:[{rowId:'r1',name:'Opener'}]};
  try{
    for(let i=0;i<20;i++)expect((await app.request('/api/resolve',json(body,{'cf-connecting-ip':`192.0.2.${i}`,'x-forwarded-for':`198.51.100.${i}`}))).status).toBe(503);
    expect((await app.request('/api/resolve',json(body,{'cf-connecting-ip':'203.0.113.1'}))).status).toBe(429);
  }finally{runs.close();}
});
it('health reports the injected deployment commit and defaults to unknown',async()=>{
  for(const gitSha of [undefined,'release-commit']){
    const {app,runs}=createApp({env:parseEnv({}),client,gitSha});
    try{expect((await (await app.request('/api/health')).json()).gitSha).toBe(gitSha??'unknown');}
    finally{runs.close();}
  }
});
it('scenario discovery separates fixture-backed and live-safe examples in both endpoints',async()=>{
  for(const mode of ['fixture','live'] as const){
    const {app,runs}=createApp({env:parseEnv({QLOO_MODE:mode,QLOO_API_KEY:'synthetic-unit-only'}),client});
    try{
      const expected=mode==='fixture'?['fx-sg-indie']:['live-sg-indie-example'];
      const rows=await(await app.request('/api/scenarios')).json();expect(rows.map((s:any)=>s.id)).toEqual(expected);
      expect((await(await app.request('/api/health')).json()).scenarios).toEqual(expected);
      expect(rows.every((s:any)=>mode==='fixture'?s.synthetic:s.liveSafe&&!s.synthetic)).toBe(true);
      if(mode==='live'){expect(rows[0].request.headlinerQuery).toBe('Phoebe Bridgers');expect(rows[0].request.roster.map((r:any)=>r.name)).toContain('Low');expect(JSON.stringify(rows)).not.toContain('fx-art-');}
    }finally{runs.close();}
  }
});
