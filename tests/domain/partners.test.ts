import { expect,test } from 'vitest';
import type { PartnerShortlist, QueryParams } from '../../src/shared/types';
import { buildShortlistEvidence,haversineM } from '../../src/domain/partners';
import { call,fixture,placeParams,scenario } from './helpers';
// Independent spherical law of cosines, not the implementation's haversine expression.
function reference(lat:number,lon:number,a:number,b:number):number {const r=Math.PI/180;return 6371008.8*Math.acos(Math.min(1,Math.max(-1,Math.sin(lat*r)*Math.sin(a*r)+Math.cos(lat*r)*Math.cos(a*r)*Math.cos((b-lon)*r))));}
test('D9: fixture distances use an independent reference; far-place observation and scopes',()=>{
  const s=scenario();const place=s.partners.find(p=>p.category==='place')!;const coordinates=[[1.3021,103.8590],[1.2950,103.8500],[1.2836,103.8443],[1.3400,103.9000]];
  place.items.forEach((item,i)=>expect(Math.abs(item.distanceM!-reference(1.3,103.855,coordinates[i][0],coordinates[i][1]))).toBeLessThanOrEqual(1));
  expect(place.uncertainty).toEqual(['1 place(s) are farther than the requested radius']);expect(place.scope).toBe('near_venue_point');expect(s.partners.filter(p=>p.category!=='place').every(p=>p.scope==='global_taste')).toBe(true);
  const c=call(fixture('fx-sg-indie/place.json'),[['filter.type','urn:entity:place'],['filter.geocode.name','Singapore']]);expect(buildShortlistEvidence(c,'place',{...s.request.venue,lat:null,lon:null},[],'scripted').shortlist.scope).toBe('city_name_match');
});
test('D9: excluded identities/duplicates, missing affinity, nested location and invalid coordinates',()=>{
  const s=scenario();const body={results:{entities:[{id:'fx-art-hl',name:'Headliner',affinity:1},{id:'fx-art-ss',name:'Opener',affinity:1},{id:'fx-p',name:'P',affinity:0,location:{lat:null,lon:null},properties:{geocode:{latitude:1.3,longitude:103.855}}},{id:'fx-p',name:'Duplicate',affinity:0.9},{id:'fx-missing',name:'Missing',location:{lat:999,lon:0}}]}};
  const {shortlist,receipts}=buildShortlistEvidence(call(body,[['filter.type','urn:entity:place'],['signal.interests.entities','fx-art-hl'],...placeParams(s.request.venue)]),'place',s.request.venue,[],'scripted',['fx-art-ss']);
  expect(shortlist.items.map(i=>[i.entityId,i.affinity,i.distanceM])).toEqual([['fx-p',0,0],['fx-missing',null,null]]);expect(receipts).toHaveLength(1);expect(shortlist.uncertainty).toContain('duplicate result IDs');
  expect(haversineM(null,null,0,0)).toBeNull();expect(haversineM(0,0,91,0)).toBeNull();expect(haversineM(0,0,0,180)).toBe(20015114);expect(haversineM(0,0,0,1)).toBe(111195);
});

const empty={results:{entities:[]}};
const point:QueryParams=[['filter.location','POINT(103.855 1.3)'],['filter.location.radius','3000']];
const placeCall=(params:QueryParams,body:unknown=empty)=>call(body,[['filter.type','urn:entity:place'],...params]);
test('D9 R1: missing/mismatched point/radius and conflicting scope fail, including empty responses',()=>{
  const venue=scenario().request.venue;
  const invalid:QueryParams[]=[[],[point[0]],[point[1]],[['filter.location','POINT(0 1.3)'],point[1]],[['filter.location','POINT(103.855 0)'],point[1]],[point[0],['filter.location.radius','3001']],[point[0],['filter.location.radius','']],[point[0],['filter.location.radius','NaN']],[['filter.location','POINT(103.855 Infinity)'],point[1]],[...point,['filter.geocode.name','Singapore']],[...point,['filter.location.query','Singapore']],[...point,point[0]]];
  for(const body of [empty,fixture('fx-sg-indie/place.json')])for(const params of invalid)expect(()=>buildShortlistEvidence(placeCall(params,body),'place',venue,[],'scripted'),JSON.stringify(params)).toThrow(/scope/);
});
test('D9 R1: city scope requires exact recorded city and no simultaneous point/radius',()=>{
  const venue={...scenario().request.venue,lat:null,lon:null};
  for(const params of [[],[['filter.geocode.name','London']],[['filter.geocode.name','singapore']],[['filter.geocode.name','']],[['filter.geocode.name','Singapore'],point[0]],[['filter.geocode.name','Singapore'],point[1]],[['filter.geocode.name','Singapore'],['filter.location.query','Singapore']]] as QueryParams[]){
    for(const body of [empty,fixture('fx-sg-indie/place.json')])expect(()=>buildShortlistEvidence(placeCall(params,body),'place',venue,[],'scripted')).toThrow(/scope/);
  }
  expect(buildShortlistEvidence(placeCall([['filter.geocode.name','Singapore']]),'place',venue,[],'scripted').shortlist.scope).toBe('city_name_match');
});
test('D9 R1: equivalent numeric point/radius representations preserve the recorded request',()=>{
  const venue=scenario().request.venue;
  const params:QueryParams=[['filter.location','POINT(103.85500 1.3000)'],['filter.location.radius','3e3']];
  const {shortlist,receipts}=buildShortlistEvidence(placeCall(params,fixture('fx-sg-indie/place.json')),'place',venue,[],'scripted');
  expect(shortlist.scope).toBe('near_venue_point');expect(shortlist.items).toHaveLength(4);expect(shortlist.uncertainty).toEqual(['1 place(s) are farther than the requested radius']);
  expect(receipts[0].params).toEqual([['filter.type','urn:entity:place'],...params]);
});
const selected:PartnerShortlist['tagFilter']=[{id:'urn:tag:fixture:a',name:'A',receiptId:'R-a'},{id:'urn:tag:fixture:b',name:'B',receiptId:'R-b'}];
test('D9 R1: missing/extra/different recorded tags fail for every category, even empty results',()=>{
  const venue=scenario().request.venue;
  for(const category of ['brand','place','podcast'] as const){
    const base:QueryParams=[['filter.type',`urn:entity:${category}`],...(category==='place'?point:[])];
    for(const tags of [undefined,'urn:tag:fixture:a','urn:tag:fixture:a,urn:tag:fixture:b,urn:tag:fixture:c','urn:tag:fixture:a,urn:tag:fixture:c','']){
      const params:QueryParams=[...base,...(tags===undefined?[]:[['filter.tags',tags] as [string,string]])];
      expect(()=>buildShortlistEvidence(call(empty,params),category,venue,selected,'scripted')).toThrow(/tag/);
    }
    expect(()=>buildShortlistEvidence(call(empty,[...base,['filter.tags','urn:tag:fixture:a']]),category,venue,[],'scripted')).toThrow(/tag/);
  }
});
test('D9 R1: tag order is set-equivalent and no recorded/selected tags means empty',()=>{
  const venue=scenario().request.venue;const params:QueryParams=[...point,['filter.tags','urn:tag:fixture:b,urn:tag:fixture:a']];
  const shortlist=buildShortlistEvidence(placeCall(params),'place',venue,selected,'llm').shortlist;
  expect(shortlist.tagFilter).toEqual(selected);expect(shortlist.items).toEqual([]);
  expect(buildShortlistEvidence(placeCall(point),'place',venue,[],'scripted').shortlist.tagFilter).toEqual([]);
  expect(()=>buildShortlistEvidence(placeCall([...params,['filter.tags','urn:tag:fixture:a']]),'place',venue,selected,'scripted')).toThrow(/duplicate/);
});
test('D9 R1: global labels cannot be applied to recorded place-scoped calls',()=>{
  const venue=scenario().request.venue;
  for(const category of ['brand','podcast'] as const)expect(()=>buildShortlistEvidence(call(empty,[['filter.type',`urn:entity:${category}`],...point]),category,venue,[],'scripted')).toThrow(/scope/);
});
test('place metadata accepts complete same-shape coordinates and flattened address with nested precedence',()=>{
  const venue=scenario().request.venue;
  const entities=[
    {id:'fx-flat',name:'Flat',lat:venue.lat,lon:venue.lon,address:'Synthetic root address',affinity:0},
    {id:'fx-location',name:'Location',location:{lat:venue.lat,lon:venue.lon},lat:0,lon:0,address:'Root',properties:{address:'Nested'}},
    {id:'fx-geo',name:'Geo',location:{lat:venue.lat},properties:{geocode:{latitude:venue.lat,longitude:venue.lon}},lat:0,lon:0},
    {id:'fx-mixed',name:'Mixed',location:{lat:venue.lat},properties:{geocode:{longitude:venue.lon}},lat:venue.lat},
    {id:'fx-string',name:'String',lat:String(venue.lat),lon:venue.lon,address:123},
  ];
  const result=buildShortlistEvidence(placeCall(point,{results:{entities}}),'place',venue,[],'scripted');
  expect(result.shortlist.items.map(i=>[i.distanceM,i.address])).toEqual([[0,'Synthetic root address'],[0,'Nested'],[0,null],[null,null],[null,null]]);
  expect(result.receipts[0]).toMatchObject({valuePath:'results.entities[0].affinity',value:0,entity:{id:'fx-flat'}});
});
