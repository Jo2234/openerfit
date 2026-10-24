import type { Brief, BriefRequest, Receipt, ResolveResponse, Run, SearchCandidate } from '../../src/shared/types';
import scenarios from '../../fixtures/scenarios.json';
// Hand-written synthetic component inputs, never a production API replacement.
export const input=()=>structuredClone(scenarios[0].request) as BriefRequest;
export const receipt:Receipt={id:'R-zero',callId:'C-component',endpoint:'/v2/insights',params:[['filter.type','urn:entity:artist'],['take','7']],origin:'fixture',fixtureLabel:'hand-written synthetic component fixture',valuePath:'results.entities[0].query.affinity',value:0,rawValueText:'0',entity:{id:'fx-zero',name:'Zero Act',subtype:'urn:entity:artist'},requestedAt:'2026-10-18T00:00:00.000Z',liveFetchedAt:null};
export const candidate=(id:string,name:string):SearchCandidate=>({entityId:id,name,subtype:'urn:entity:artist',disambiguation:null,popularity:null,receiptId:`R-${id}`});
export function resolution():ResolveResponse {
  const head=candidate('fx-head','Harbour Lights'),one=candidate('fx-one','Saltwater Static');
  return {resolveId:'resolve_'+'1'.repeat(32),headliner:{target:'headliner',inputName:'Harbour Lights',status:'auto_matched',chosen:head,candidates:[head],searchCallId:'C-head'},roster:[
    {target:'r1',inputName:'Saltwater Static',status:'auto_matched',chosen:one,candidates:[one],searchCallId:'C-one'},
    {target:'r2',inputName:'Moth Parade',status:'needs_confirmation',chosen:null,candidates:[{...candidate('fx-moth-a','Moth Parade'),disambiguation:'2019, Singapore indie'},{...candidate('fx-moth-b','Moth Parade'),disambiguation:'2008, US hardcore'}],searchCallId:'C-moth'},
    {target:'r7',inputName:'Velvet Monsoon',status:'needs_confirmation',chosen:null,candidates:[candidate('fx-velvet','Velvet Monsoon Trio')],searchCallId:'C-velvet'},
    {target:'r8',inputName:'Echo Park Ferry',status:'not_found',chosen:null,candidates:[],searchCallId:'C-empty'},
  ],receipts:[]};
}
export function brief():Brief {
  return {runId:'run_'+'2'.repeat(32),createdAt:'2026-10-18T00:00:00.000Z',request:input(),ranking:{headliner:{entityId:'fx-head',name:'Harbour Lights',receiptId:'R-head'},rows:[
    {rowId:'r1',inputName:'Zero Act',entityId:'fx-zero',qlooName:'Zero Act',status:'ranked',affinity:0,affinityReceiptId:receipt.id,affinityRank:1,qlooOrder:0,outOfRange:false,bookability:'unknown',feeAmount:0,withinBudget:true,shortlistEligible:true},
    {rowId:'r6',inputName:'Unscored Act',entityId:'fx-unscored',qlooName:'Unscored Act',status:'no_affinity_returned',affinity:null,affinityReceiptId:null,affinityRank:null,qlooOrder:null,outOfRange:false,bookability:'unavailable',feeAmount:null,withinBudget:null,shortlistEligible:false},
  ],recommendedRowIds:['r1'],rankingCallId:'C-component',uncertainty:[]},partners:[],systemNotes:['Synthetic application observation.'],claims:[],droppedClaims:[],writer:{kind:'llm',source:'fixture',fixtureLabel:'Hand-written selector fixture',model:'hand-written fixture',promptVersion:'ofv1.1',attempts:2,fallbackReason:null},receipts:[receipt],origins:['fixture'],disclaimer:'Synthetic policy field.'};
}
export function run():Run {
  const b=brief();return {id:b.runId,state:'done',request:b.request,resolutions:{headliner:b.ranking.headliner,roster:[]},options:{planner:'auto',baseline:false},steps:[],brief:b,baseline:null,diff:null,error:null,startedAt:b.createdAt,finishedAt:b.createdAt,qlooCallCount:1};
}
