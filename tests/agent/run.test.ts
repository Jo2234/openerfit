import { expect,test } from 'vitest';
import { NoneLlmAdapter } from '../../src/agent/llm/adapter';
import { FixtureLlmAdapter } from '../../src/agent/llm/fixture';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import { QlooError } from '../../src/qloo/errors';
import { buildInsightsQuery } from '../../src/qloo/params';
import { callRecord } from '../../src/qloo/record';
import { runSchema } from '../../src/shared/schemas';
import { exportBrief,assertAcceptedClaims } from '../../src/domain/brief';
import { harness,TestAdapter,completed,request } from './helpers';
test('A1: real scripted fixture flow has system rank0, three partner tools, template and unavailable baseline',async()=>{
  const h=await harness(new NoneLlmAdapter());try{const run=await h.pending;expect(runSchema.safeParse(run).success).toBe(true);expect(run.state).toBe('done');expect(run.steps.map(s=>s.tool)).toEqual(['rank_roster','find_partners','find_partners','find_partners']);expect(run.steps[0].planner).toBe('system');expect(run.qlooCallCount).toBe(4);expect(run.brief?.writer).toMatchObject({kind:'template',source:null,fixtureLabel:null,model:null});expect(run.baseline?.status).toBe('unavailable');expect(run.brief?.ranking.recommendedRowIds).toEqual(['r1','r2','r5']);expect(run.brief?.claims.every(c=>c.author==='template')).toBe(true);
    const ids=new Set(run.brief!.receipts.map(r=>r.id));for(const s of run.steps)for(const id of s.receiptIds)expect(ids.has(id)).toBe(true);for(const receipt of h.evidence.receipts)expect(ids.has(receipt.id)).toBe(true);assertAcceptedClaims(run.brief!);
  }finally{h.store.close();}
});
test('A2: hand-written planner/selector/baseline fixtures exercise coverage, one repair and literal baseline diff',async()=>{
  const h=await harness(new FixtureLlmAdapter());try{const run=await h.pending;expect(run.state).toBe('done');expect(run.steps.filter(s=>s.kind==='tool_call').map(s=>[s.tool,s.planner])).toEqual([['rank_roster','system'],['search_tags','llm'],['find_partners','llm'],['find_partners','llm'],['find_partners','scripted']]);expect(run.qlooCallCount).toBe(5);expect(run.brief?.writer).toMatchObject({kind:'llm',source:'fixture',attempts:2});expect(run.brief?.claims.every(c=>c.author==='template')).toBe(true);expect(run.brief?.droppedClaims).toEqual([]);expect(run.brief?.partners.find(p=>p.category==='place')?.tagFilter[0].id).toBe('urn:tag:fixture:place:craft_beer');expect(run.diff?.changedPositions).toBe(6);expect(run.diff?.kendallTau).toBe(0.2);expect(run.baseline?.source).toBe('fixture');expect(exportBrief(run.brief!,'html')).toContain('not a model output');
  }finally{h.store.close();}
});
test('A3/A5: unseen tag action twice is rejected before calls then scripted coverage completes',async()=>{
  const adapter=new TestAdapter(r=>completed(r.schemaName==='planner_action'?'{"action":"find_partners","category":"place","tagIds":["urn:tag:invented"]}':r.schemaName==='brief_claims'?'{"claimIds":[]}':'{}'));
  const client=new FixtureQlooClient();let inventedCalls=0;const original=client.insights.bind(client);client.insights=(args,signal)=>{if(args.tagIds?.includes('urn:tag:invented'))inventedCalls++;return original(args,signal);};
  const h=await harness(adapter,client,request(),false);try{const run=await h.pending;expect(run.state).toBe('done');expect(inventedCalls).toBe(0);expect(adapter.requests.filter(r=>r.schemaName==='planner_action')).toHaveLength(2);expect(run.steps.filter(s=>s.kind==='llm_action_rejected')).toHaveLength(2);expect(run.qlooCallCount).toBe(4);}finally{h.store.close();}
});
test('A4/A8: repeated canonical find is rejected within six decisions, preserving coverage and call limits',async()=>{
  const adapter=new TestAdapter(r=>completed(r.schemaName==='planner_action'?'{"action":"find_partners","category":"brand","tagIds":[]}':'{"claimIds":[]}'));
  const h=await harness(adapter,undefined,request(),false);try{const run=await h.pending;expect(adapter.requests.filter(r=>r.schemaName==='planner_action')).toHaveLength(6);expect(run.steps.filter(s=>s.kind==='llm_action_rejected')).toHaveLength(5);expect(run.qlooCallCount).toBe(4);expect(run.brief?.partners.map(p=>p.category)).toEqual(['brand','place','podcast']);}finally{h.store.close();}
});
test('A8: three search attempts and six turns hard-cap repeated exploration; partner failures are observations',async()=>{
  const adapter=new TestAdapter(r=>completed(r.schemaName==='planner_action'?JSON.stringify({action:'search_tags',query:`synthetic query ${r.fixtureKey.step}`}):'{"claimIds":[]}'));
  const client=new FixtureQlooClient();let tagCalls=0;const originalTags=client.tags.bind(client),originalInsights=client.insights.bind(client);
  client.tags=(args,s)=>{tagCalls++;return originalTags(args,s);};client.insights=(args,s)=>args.type==='urn:entity:brand'?Promise.reject(new QlooError('qloo_timeout','SECRET upstream',504)):originalInsights(args,s);
  const h=await harness(adapter,client,request(),false);try{const run=await h.pending;expect(run.state).toBe('done');expect(tagCalls).toBe(3);expect(run.qlooCallCount).toBe(7);expect(run.qlooCallCount).toBeLessThanOrEqual(14);expect(run.brief?.partners.some(p=>p.category==='brand')).toBe(false);expect(JSON.stringify(run.brief)).not.toContain('SECRET upstream');expect(run.steps.some(s=>s.error?.code==='qloo_timeout')).toBe(true);}finally{h.store.close();}
});
test('A1/v1.1: successful empty affinity response completes unscored without fabricated ranking receipts',async()=>{
  const client=new FixtureQlooClient(),original=client.insights.bind(client);
  client.insights=(args,s)=>args.type==='urn:entity:artist'?Promise.resolve(callRecord('/v2/insights',buildInsightsQuery(args).params,'{"results":{"entities":[]}}',{origin:'live-cache',status:200,durationMs:0,requestedAt:'2026-10-18T00:00:00.000Z',liveFetchedAt:'2026-10-17T00:00:00.000Z',warnings:[]})):original(args,s);
  const h=await harness(new NoneLlmAdapter(),client);try{const run=await h.pending;expect(run.state).toBe('done');expect(run.brief?.ranking.recommendedRowIds).toEqual([]);expect(run.brief?.ranking.rows.filter(r=>r.status==='no_affinity_returned')).toHaveLength(7);expect(run.brief?.claims.some(c=>c.section==='openers')).toBe(false);expect(run.brief?.origins).toEqual(expect.arrayContaining(['fixture','live-cache']));}finally{h.store.close();}
});
test('A5/A12: malformed planner twice switches to coverage; baseline invalid twice remains nonfatal',async()=>{
  const adapter=new TestAdapter(r=>completed(r.schemaName==='planner_action'?'not JSON':r.schemaName==='brief_claims'?'{"claimIds":[]}':'{}'));
  const h=await harness(adapter);try{const run=await h.pending;expect(run.state).toBe('done');expect(run.qlooCallCount).toBe(4);expect(adapter.requests.filter(r=>r.schemaName==='planner_action')).toHaveLength(2);expect(adapter.requests.filter(r=>r.schemaName==='baseline')).toHaveLength(2);expect(run.baseline?.status).toBe('invalid_output');expect(run.baseline?.output).toBeNull();expect(run.diff).toBeNull();expect(JSON.stringify(run.brief?.systemNotes)).not.toContain('not JSON');}finally{h.store.close();}
});
test('A8: at most two partner calls/category and every replaced-result trace receipt stays in Brief',async()=>{
  const actions=[{action:'search_tags',query:'craft beer'},{action:'find_partners',category:'place',tagIds:['urn:tag:fixture:place:craft_beer']},{action:'find_partners',category:'place',tagIds:[]},{action:'find_partners',category:'place',tagIds:['urn:tag:fixture:place:brewery']},{action:'find_partners',category:'place',tagIds:['urn:tag:fixture:place:brewery','urn:tag:fixture:place:craft_beer']},{action:'finish'}];
  const adapter=new TestAdapter(r=>completed(r.schemaName==='planner_action'?JSON.stringify(actions[r.fixtureKey.step]):'{"claimIds":[]}'));
  const h=await harness(adapter,undefined,request(),false);try{const run=await h.pending;expect(run.state).toBe('done');expect(run.qlooCallCount).toBe(6);expect(run.steps.filter(s=>s.tool==='find_partners'&&s.args?.category==='place'&&s.kind==='tool_call')).toHaveLength(2);expect(run.steps.filter(s=>s.kind==='llm_action_rejected')).toHaveLength(2);expect(run.brief?.partners.find(p=>p.category==='place')?.items[0].entityId).toBe('fx-place-0');
    const ids=new Set(run.brief!.receipts.map(r=>r.id));for(const step of run.steps)for(const receiptId of step.receiptIds)expect(ids.has(receiptId)).toBe(true);
    expect(run.brief?.receipts.some(r=>r.entity?.id==='fx-place-1'&&r.value===0.9012)).toBe(true);expect(run.brief?.receipts.some(r=>r.entity?.id==='fx-place-1'&&r.value===0.8455)).toBe(true);
  }finally{h.store.close();}
});
