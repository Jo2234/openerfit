import { expect,test } from 'vitest';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolSession } from '../../src/agent/tools';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import type { QlooClient } from '../../src/qloo/client';
import type { PartnerCategory,Run } from '../../src/shared/types';
import { plannerActionSchema } from '../../src/agent/protocol';
import { BASELINE_SYSTEM,WRITER_SYSTEM,PROMPT_VERSION,baselineUser,writerUser,repairUser } from '../../src/agent/prompts';
import { scenario } from '../domain/helpers';
import { TestAdapter,completed,harness } from './helpers';
function session(categories:PartnerCategory[]=['brand','place','podcast'],client:QlooClient=new FixtureQlooClient()){
  const s=scenario();s.request.partnerCategories=categories;
  const run:Run={id:'run_progress',state:'partners',request:s.request,resolutions:s.confirmed,options:{planner:'auto',baseline:false},steps:[],brief:null,baseline:null,diff:null,error:null,startedAt:'2026-10-18T00:00:00.000Z',finishedAt:null,qlooCallCount:0};
  return new ToolSession({run,client,searchReceipts:s.evidence.receipts,signal:new AbortController().signal,transition:()=>true,step:()=>true});
}
test('progress lists only requested categories, in request order, as independent snapshots',()=>{
  const s=session(['podcast','brand']),view=s.categoryProgress();
  expect(view).toEqual(['podcast','brand'].map(category=>({category,status:'pending',partnerCallsUsed:0,partnerCallsRemaining:2,unfilteredAttempted:false})));
  expect(Object.keys(view[0]).sort()).toEqual(['category','partnerCallsRemaining','partnerCallsUsed','status','unfilteredAttempted']);
  Object.assign(view[0],{partnerCallsUsed:99,status:'completed'});expect(s.categoryProgress()[0]).toMatchObject({status:'pending',partnerCallsUsed:0});
});
test('successful partner evidence completes a category without completing other categories',async()=>{
  const s=session();expect((await s.execute({action:'find_partners',category:'brand',tagIds:[]},'llm')).status).toBe('ok');
  expect(s.categoryProgress()).toEqual([{category:'brand',status:'completed',partnerCallsUsed:1,partnerCallsRemaining:1,unfilteredAttempted:true},...['place','podcast'].map(category=>({category,status:'pending',partnerCallsUsed:0,partnerCallsRemaining:2,unfilteredAttempted:false}))]);
});
test('failed partner attempts spend their call budget but remain pending',async()=>{
  const fixtures=new FixtureQlooClient(),client:QlooClient={mode:'fixture',search:fixtures.search.bind(fixtures),tags:fixtures.tags.bind(fixtures),insights:async()=>{throw Error('synthetic upstream failure');}};
  const s=session(['brand'],client);expect((await s.execute({action:'find_partners',category:'brand',tagIds:[]},'llm')).status).toBe('error');
  expect(s.categoryProgress()).toEqual([{category:'brand',status:'pending',partnerCallsUsed:1,partnerCallsRemaining:1,unfilteredAttempted:true}]);
});
test('a successful empty shortlist is completed using the same coverage rule',async()=>{
  const fixtures=new FixtureQlooClient(),client:QlooClient={mode:'fixture',search:fixtures.search.bind(fixtures),tags:fixtures.tags.bind(fixtures),insights:async(args,signal)=>({...await fixtures.insights(args,signal),body:{results:{entities:[]}}})};
  const s=session(['brand'],client);expect((await s.execute({action:'find_partners',category:'brand',tagIds:[]},'llm')).status).toBe('ok');
  expect(s.partners.get('brand')?.items).toHaveLength(0);expect(s.categoryProgress()[0]).toMatchObject({status:'completed',partnerCallsUsed:1});
});
test('duplicate rejection does not spend another call or change progress',async()=>{
  const s=session(['brand']),action={action:'find_partners' as const,category:'brand' as const,tagIds:[]};
  await s.execute(action,'llm');const before=s.categoryProgress();expect((await s.execute(action,'llm')).status).toBe('rejected');expect(s.categoryProgress()).toEqual(before);expect(s.callCount).toBe(1);
});
test('success-looking note text cannot forge category completion',()=>{
  const s=session(['brand']);s.note('Found 8 brand partners.');expect(s.categoryProgress()).toEqual([{category:'brand',status:'pending',partnerCallsUsed:0,partnerCallsRemaining:2,unfilteredAttempted:false}]);
});
test('a tagged result can still be followed by the permitted unfiltered second call',async()=>{
  const s=session(['place']);await s.execute({action:'search_tags',query:'craft beer'},'llm');
  expect((await s.execute({action:'find_partners',category:'place',tagIds:['urn:tag:fixture:place:craft_beer']},'llm')).status).toBe('ok');
  expect(s.categoryProgress()[0]).toMatchObject({status:'completed',partnerCallsUsed:1,partnerCallsRemaining:1,unfilteredAttempted:false});
  expect((await s.execute({action:'find_partners',category:'place',tagIds:[]},'llm')).status).toBe('ok');
  expect(s.categoryProgress()[0]).toMatchObject({status:'completed',partnerCallsUsed:2,partnerCallsRemaining:0,unfilteredAttempted:true});
});
test('every planner turn receives fresh canonical progress with the full booker input',async()=>{
  const seen:any[]=[],s=scenario(),adapter=new TestAdapter(r=>{
    if(r.schemaName!=='planner_action')return completed('{"claimIds":[]}');
    expect(r.user).toContain(JSON.stringify({booker_input:s.request}));const line=r.user.split('\n').find(l=>l.startsWith('{"qloo_observations":'))!;seen.push(JSON.parse(line).qloo_observations.categoryProgress);
    return completed(seen.length===1?'{"action":"find_partners","category":"brand","tagIds":[]}':'{"action":"finish"}');
  });
  const h=await harness(adapter,undefined,s.request,false);try{await h.pending;expect(seen).toHaveLength(2);expect(seen[0][0]).toMatchObject({category:'brand',status:'pending',partnerCallsUsed:0});expect(seen[1][0]).toMatchObject({category:'brand',status:'completed',partnerCallsUsed:1});}finally{h.store.close();}
});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
test('writer, baseline, repair framing and their version remain byte-identical to 774481f',()=>{
  const request=scenario().request;
  expect({BASELINE_SYSTEM:hash(BASELINE_SYSTEM),WRITER_SYSTEM:hash(WRITER_SYSTEM),baselineUser:hash(baselineUser(request)),writerUser:hash(writerUser(request,[])),repairBaseline:hash(repairUser(baselineUser(request),'baseline')),repairWriter:hash(repairUser(writerUser(request,[]),'selection'))}).toEqual({BASELINE_SYSTEM:'3c08c4b1971ab93678d31882a99875bc459c77c67b1ccd092cdef285ccfba073',WRITER_SYSTEM:'a26541576c29f5c9adb8ed275a3c6fea850ac45da642c8d06215f976a590d8a6',baselineUser:'231cc88cf2ad702e3a769148c3a854ea72bb258446aacb79bb0b9aaec9a119dd',writerUser:'f8412b535dd246f4e6e52bd9f5b56423c72292f8ef85515fab0287bc7f3fc6ff',repairBaseline:'9b4e9b9b21088320e2ca7f1980e824972793a26116c0499c49021d4dc6105f5f',repairWriter:'bada1c72199484ec2098fff16f7f0cc1688cfcb08af05ffbf255a65b89ab81fe'});
  expect(PROMPT_VERSION).toBe('ofv1.1');expect(baselineUser(request)).not.toContain('categoryProgress');
});
test('planner action schemas remain byte-identical for full and tagged subset categories',()=>{
  expect(hash(JSON.stringify(z.toJSONSchema(plannerActionSchema(['brand','place','podcast'],[]))))).toBe('392d91caf1c98400eb44a0d905d66260cc3bdf17b0a25fd248221573eb654e3b');
  expect(hash(JSON.stringify(z.toJSONSchema(plannerActionSchema(['place'],['urn:tag:fixture:place:craft_beer']))))).toBe('9ce88638ca19af48de2cdb51e8c077cb88866b92da0c4ed36aff92290338e6d3');
});
