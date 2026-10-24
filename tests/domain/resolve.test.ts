import { expect,test } from 'vitest';
import { resolveFromRecords,resolveName } from '../../src/domain/resolve';
import { tagObservations } from '../../src/domain/receipts';
import { call,scenario } from './helpers';
test('D4: exact unique artists only, same-name ambiguity, accents and inexact confirmation',()=>{
  const resolve=(name:string,rows:unknown,types=true)=>resolveName(call({results:rows},types?[['types','urn:entity:artist']]:[],'/search'),name,'r1').resolution;
  expect(scenario().evidence.roster[1].status).toBe('needs_confirmation');
  expect(resolve('the saltwater static!',[{entity_id:'fx-a',name:'Saltwater Static'}]).status).toBe('auto_matched');
  expect(resolve('Beyoncé',[{id:'fx-b',name:'Beyonce',types:['urn:entity:artist']}]).chosen?.entityId).toBe('fx-b');
  expect(resolve('Velvet Monsoon',[{id:'fx-v',name:'Velvet Monsoon Trio'}]).status).toBe('needs_confirmation');
  expect(resolve('Missing',[]).status).toBe('not_found');
  expect(resolve('Act',[{id:'fx-p',name:'Act',subtype:'urn:entity:place'}]).status).toBe('needs_confirmation');
  expect(resolve('Act',[{id:'fx-a',name:'Act'}],false).status).toBe('needs_confirmation');
});
test('D4: alternate search shape binds candidate name evidence and preserves all search receipts',()=>{
  const c=call({results:{entities:[{id:'fx-x',name:'Exact',properties:{disambiguation:'Fictional origin'}}]}},[['types','urn:entity:artist']],'/search');
  const r=resolveName(c,'Exact','headliner');expect(r.resolution.chosen?.disambiguation).toBe('Fictional origin');expect(r.receipts[0].valuePath).toBe('results.entities[0].name');expect(r.receipts[0].entity?.id).toBe('fx-x');
  const s=scenario();expect(s.evidence.receipts).toHaveLength(9);expect(s.evidence.roster[1].candidates.map(c=>c.receiptId).every(id=>s.evidence.receipts.some(r=>r.id===id))).toBe(true);
  expect(()=>resolveFromRecords({headlinerQuery:s.request.headlinerQuery,roster:s.request.roster},s.calls.slice(1))).toThrow('coverage');
  expect(()=>resolveFromRecords({headlinerQuery:'Other',roster:s.request.roster},s.calls)).toThrow('query mismatch');
});
test('D4: tag response shapes preserve exact ID paths and name/entity binding',()=>{
  for(const [body,path] of [[{results:{tags:[{tag_id:'urn:tag:fixture:a',name:'A'}]}},'results.tags[0].tag_id'],[{results:[{id:'urn:tag:fixture:a',name:'A'}]},'results[0].id']] as const){const r=tagObservations(call(body,[],'/v2/tags'));expect(r.tags[0].id).toBe('urn:tag:fixture:a');expect(r.receipts[0].valuePath).toBe(path);expect(r.receipts[0].entity?.name).toBe('A');}
});
