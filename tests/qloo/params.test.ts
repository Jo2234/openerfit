import { describe,expect,it,vi } from 'vitest';
import { buildInsightsQuery,buildSearchQuery,buildTagsQuery,canonicalQuery } from '../../src/qloo/params';
const p={type:'urn:entity:artist' as const,interestEntityIds:['fx-art-hl'],take:7};
describe('Qloo parameter boundaries',()=>{
 it('Q1: enumerates seven confirmed IDs and preserves list order',()=>{
 const q=buildInsightsQuery({...p,resultEntityIds:['fx-art-ss','fx-art-mp1','fx-art-kn','fx-art-plc','fx-art-lc','fx-art-nd','fx-art-vm']});
 expect(q.params).toEqual([['filter.results.entities','fx-art-ss,fx-art-mp1,fx-art-kn,fx-art-plc,fx-art-lc,fx-art-nd,fx-art-vm'],['filter.type','urn:entity:artist'],['signal.interests.entities','fx-art-hl'],['take','7']]);
 expect(canonicalQuery(q.params)).toBe('filter.results.entities=fx-art-ss%2Cfx-art-mp1%2Cfx-art-kn%2Cfx-art-plc%2Cfx-art-lc%2Cfx-art-nd%2Cfx-art-vm&filter.type=urn%3Aentity%3Aartist&signal.interests.entities=fx-art-hl&take=7');
 });
 it('Q2/Q10: rejects invalid tiers, typo, values and radius without a point before fetch',()=>{
 const fetch=vi.spyOn(globalThis,'fetch');
 for(const patch of [{take:0},{take:51},{resultEntityIds:[]},{resultEntityIds:['a,b']},{extra:[['filter.location','POINT(1 2)']]},{type:'urn:entity:place',extra:[['filter.locaton','POINT(1 2)']]},{type:'urn:entity:place',locationPoint:{lon:200,lat:1}},{type:'urn:entity:place',radiusM:800001},{type:'urn:entity:place',radiusM:1},{extra:[['filter.popularity.min','1.5']]}])expect(()=>buildInsightsQuery({...p,...patch} as any)).toThrow();
 expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
 });
 it('Q3: accepts reference-only only through the internal switch with warning',()=>{const q={...p,extra:[['signal.location.query','Singapore']] as [string,string][]};expect(()=>buildInsightsQuery(q)).toThrowError(/tier_not_allowed/);expect(buildInsightsQuery(q,{allowReferenceOnly:true}).warnings).toEqual([{param:'signal.location.query',tier:'reference_only',message:expect.any(String)}]);});
 it('v1.1: blocks duplicate/colliding keys, demographics, POST-only forms and live fixture IDs',()=>{
 for(const extra of [[['take','7']],[['signal.demographics.age','25']],[['filter.results.entities.query','[]']],[['filter.exclude.entities','fx-art-ss']]])expect(()=>buildInsightsQuery({...p,interestEntityIds:['real-headliner'],extra:extra as [string,string][]},{live:true,allowReferenceOnly:true})).toThrow();
 expect(()=>buildInsightsQuery(p,{live:true})).toThrowError(/fixture_id_in_live/);
 });
 it('search and tags apply own query names and take bounds',()=>{expect(buildSearchQuery({query:'Harbour Lights',types:['urn:entity:artist'],take:5}).params[0]).toEqual(['query','Harbour Lights']);expect(buildTagsQuery({query:'craft beer',take:10}).params).toContainEqual(['filter.query','craft beer']);expect(()=>buildSearchQuery({query:'x',types:['urn:entity:artist'],take:6})).toThrow();});
});
