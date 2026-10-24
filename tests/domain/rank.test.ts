import { expect,test } from 'vitest';
import fc from 'fast-check';
import type { BriefRequest, ConfirmedResolutions } from '../../src/shared/types';
import { rankRosterEvidence } from '../../src/domain/rank';
import { COPY } from '../../src/shared/copy';
import { call,fixture,scenario } from './helpers';
test('D1: fixture exact rank/status/budget/eligibility and recommendations',()=>{
  const {ranking}=scenario();
  expect(ranking.rows.map(r=>[r.rowId,r.affinityRank,r.status,r.affinity,r.withinBudget,r.shortlistEligible])).toEqual([
    ['r1',1,'ranked',0.9127,true,true],['r3',2,'ranked',0.8741,false,false],['r4',3,'ranked',0.8615,true,false],['r2',4,'ranked',0.8032,true,true],['r5',5,'ranked',0.777,true,true],['r7',6,'ranked',0.6419,null,true],['r6',null,'no_affinity_returned',null,true,false],['r8',null,'not_in_qloo',null,true,false],
  ]);expect(ranking.recommendedRowIds).toEqual(['r1','r2','r5']);
});
test('D2: 200 random constraint assignments cannot change affinity or ordinal ranks',()=>{
  const {rankingCall,confirmed,request}=scenario();const expected=[['r1',1,0.9127],['r3',2,0.8741],['r4',3,0.8615],['r2',4,0.8032],['r5',5,0.777],['r7',6,0.6419],['r6',null,null],['r8',null,null]];
  fc.assert(fc.property(fc.array(fc.record({feeAmount:fc.option(fc.double({min:0,max:1e8,noNaN:true}),{nil:null}),bookability:fc.constantFrom('available' as const,'unavailable' as const,'unknown' as const),notes:fc.string({maxLength:200})}),{minLength:8,maxLength:8}),fc.option(fc.double({min:0,max:1e8,noNaN:true}),{nil:null}),(constraints,budget)=>{
    const changed:BriefRequest={...request,budget:{...request.budget,perOpenerMax:budget},roster:request.roster.map((r,i)=>({...r,...constraints[i]}))};
    expect(rankRosterEvidence(rankingCall,confirmed,changed).ranking.rows.map(r=>[r.rowId,r.affinityRank,r.affinity])).toEqual(expected);
  }),{numRuns:200,seed:3102});
});
test('D3: independent edge expectations, first duplicate wins, nested/flat, range and ties',()=>{
  const s=scenario();const names=['Edge Amber','Flat Birch','String Cedar','Range Dahlia','Tie Elm','Tie Fern'];
  const request={...s.request,roster:names.map((name,i)=>({rowId:`r${i+1}`,name,feeAmount:0,bookability:'unknown' as const,notes:''}))};
  const confirmed:ConfirmedResolutions={headliner:s.confirmed.headliner,roster:names.map((name,i)=>({rowId:`r${i+1}`,name,entityId:`fx-edge-${'abcdef'[i]}`,receiptId:null,status:'user_confirmed'}))};
  const result=rankRosterEvidence(call(fixture('fx-edge/ranking.json'),[['filter.type','urn:entity:artist'],['filter.results.entities','fx-edge-a,fx-edge-b,fx-edge-c,fx-edge-d,fx-edge-e,fx-edge-f'],['signal.interests.entities','fx-art-hl']]),confirmed,request);
  expect(result.ranking.rows.map(r=>[r.rowId,r.affinity,r.affinityRank])).toEqual([['r4',1.2,1],['r1',0.8,2],['r2',0.7,3],['r5',0.5,4],['r6',0.5,5],['r3',null,null]]);
  expect(result.ranking.rows[0].outOfRange).toBe(true);expect(result.ranking.rows.at(-1)?.status).toBe('no_affinity_returned');
  expect(result.receipts.find(r=>r.entity?.id==='fx-edge-b')?.valuePath).toBe('results.entities[3].affinity');
  expect(result.ranking.uncertainty).toContain('duplicate result IDs');expect(result.ranking.uncertainty).toContain('Qloo returned 1 result(s) outside the roster filter; they were ignored.');expect(result.ranking.uncertainty).toContain('Tie Elm and Tie Fern returned identical affinity (0.5)');
});
test('D3: zero differs from missing/nonfinite; finite flat fallback and raw precision sort',()=>{
  const s=scenario();const entities=[{entity_id:'fx-art-ss',name:'Saltwater Static',query:{affinity:0.50001}},{entity_id:'fx-art-mp1',name:'Moth Parade',query:{affinity:0.50002}},{entity_id:'fx-art-kn',name:'Kopi Noir',query:{affinity:Infinity},affinity:0},{entity_id:'fx-art-plc',name:'Paper Lantern Club',query:{affinity:NaN}},{entity_id:'fx-art-lc',name:'Lantern Choir',query:{affinity:'0.9'}}];
  const result=rankRosterEvidence({...s.rankingCall,body:{results:{entities}}},s.confirmed,s.request);
  expect(result.ranking.rows.slice(0,3).map(r=>[r.rowId,r.affinity])).toEqual([['r2',0.50002],['r1',0.50001],['r3',0]]);
  expect(result.receipts.find(r=>r.entity?.id==='fx-art-kn')?.valuePath).toBe('results.entities[2].affinity');
  expect(result.ranking.rows.find(r=>r.rowId==='r4')?.affinity).toBeNull();
});
test('D3: empty successful ranking returns unscored rows and no recommendations',()=>{
  const s=scenario();const {ranking}=rankRosterEvidence({...s.rankingCall,body:{results:{entities:[]}}},s.confirmed,s.request);
  expect(ranking.recommendedRowIds).toEqual([]);expect(ranking.rows.filter(r=>r.status==='no_affinity_returned')).toHaveLength(7);expect(ranking.uncertainty).toEqual([COPY.emptyInsights]);
});
