import type { InsightsParams } from './params';
export type ProbeOutcome='effect_observed'|'consistent'|'predicate_violated'|'uncertain'|'error';
export interface ProbeObservation { ids:string[]; status:number; error?:string; evidence?:unknown }
export interface ProbeClassification { outcome:ProbeOutcome; note:string; observationalOnly:boolean }
export const UNCERTAIN_NOTE='No observable difference; this does not show the parameter was ignored.';
export function classifyProbe(base:ProbeObservation,variant:ProbeObservation,predicate:boolean|null=null):ProbeClassification {
  if(base.error || variant.error || base.status<200 || base.status>=300 || variant.status<200 || variant.status>=300)return {outcome:'error',note:'One or both requests failed.',observationalOnly:false};
  if(!base.ids.length || !variant.ids.length)return {outcome:'uncertain',note:'Insufficient returned evidence. '+UNCERTAIN_NOTE,observationalOnly:true};
  if(predicate===false)return {outcome:'predicate_violated',note:'The returned evidence violates the tested predicate; unusual data remains possible.',observationalOnly:false};
  const changed=JSON.stringify(base.ids)!==JSON.stringify(variant.ids);
  if(changed)return {outcome:'effect_observed',note:predicate===null?'Results differ; this is observational only and does not establish causal parameter enforcement.':'Results differ and the tested predicate holds.',observationalOnly:predicate===null};
  if(predicate===true)return {outcome:'consistent',note:'Results are identical and the tested predicate holds.',observationalOnly:false};
  return {outcome:'uncertain',note:UNCERTAIN_NOTE,observationalOnly:true};
}
export const membershipPredicate=(ids:string[],allowed:string[]):boolean|null=>ids.length?ids.every(id=>allowed.includes(id)):null;
export const exclusionPredicate=(ids:string[],excluded:string[]):boolean|null=>ids.length?ids.every(id=>!excluded.includes(id)):null;
export const countPredicate=(base:string[],variant:string[],a:number,b:number):boolean|null=>base.length && variant.length ? base.length<=a && variant.length<=b : null;
export function jaccard(a:string[],b:string[]):number|null {const union=new Set([...a,...b]);return union.size?[...new Set(a)].filter(v=>new Set(b).has(v)).length/union.size:null;}
export interface ProbeDefinition { id:string;param:string;tier:'guide'|'reference_only';base:InsightsParams;variant:InsightsParams;predicate:'membership'|'observational'|'advisory_location'|'city'|'count'|'exclude'|'tags' }
export function probeDefinitions(input:{headlinerA:string;headlinerB:string;rosterIds:string[];excludeBrandId:string;tagId:string}):ProbeDefinition[] {
 const artist:InsightsParams={type:'urn:entity:artist',interestEntityIds:[input.headlinerA],take:20};
 const place:InsightsParams={type:'urn:entity:place',interestEntityIds:[input.headlinerA],locationPoint:{lat:1.3,lon:103.855},radiusM:3000,take:8};
 const brand:InsightsParams={type:'urn:entity:brand',interestEntityIds:[input.headlinerA],take:8};
 return [
 {id:'P1',param:'filter.results.entities',tier:'guide',base:artist,variant:{...artist,resultEntityIds:input.rosterIds},predicate:'membership'},
 {id:'P2',param:'signal.interests.entities',tier:'guide',base:artist,variant:{...artist,interestEntityIds:[input.headlinerB]},predicate:'observational'},
 {id:'P3',param:'filter.location + filter.location.radius',tier:'guide',base:place,variant:{...place,locationPoint:{lat:51.5074,lon:-.1278}},predicate:'advisory_location'},
 {id:'P4',param:'filter.geocode.name',tier:'guide',base:{...place,locationPoint:undefined,radiusM:undefined,geocodeName:'Singapore'},variant:{...place,locationPoint:undefined,radiusM:undefined,geocodeName:'London'},predicate:'city'},
 {id:'P5',param:'take',tier:'guide',base:{...brand,take:3},variant:brand,predicate:'count'},
 {id:'P6',param:'filter.exclude.entities',tier:'guide',base:brand,variant:{...brand,excludeEntityIds:[input.excludeBrandId]},predicate:'exclude'},
 {id:'P7',param:'filter.tags',tier:'guide',base:place,variant:{...place,tagIds:[input.tagId]},predicate:'tags'},
 {id:'P8',param:'signal.location.query',tier:'reference_only',base:artist,variant:{...artist,extra:[['signal.location.query','Singapore']]},predicate:'observational'},
 ];
}
