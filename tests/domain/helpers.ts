import { readFileSync } from 'node:fs';
import type { BriefRequest, ConfirmedResolutions, QlooCallRecord, QueryParams, VenueInput } from '../../src/shared/types';
import scenarios from '../../fixtures/scenarios.json';
import { resolveFromRecords } from '../../src/domain/resolve';
import { rankRosterEvidence } from '../../src/domain/rank';
import { buildShortlistEvidence } from '../../src/domain/partners';
export const fixture=(path:string):unknown=>JSON.parse(readFileSync(new URL(`../../fixtures/qloo/${path}`,import.meta.url),'utf8'));
export function call(body:unknown,params:QueryParams=[],endpoint:QlooCallRecord['endpoint']='/v2/insights',id='C-test'):QlooCallRecord {
  return {callId:id,endpoint,params,canonicalUrl:endpoint+'?'+new URLSearchParams(params),origin:'fixture',fixtureLabel:'synthetic fixture (hand-written)',httpStatus:200,durationMs:0,requestedAt:'2026-10-18T00:00:00.000Z',liveFetchedAt:null,responseSha256:'0'.repeat(64),body,paramWarnings:[]};
}
/** Record the actual synthetic scope whose label the tests assert. */
export function placeParams(venue:VenueInput):QueryParams {
  return venue.lat!==null&&venue.lon!==null
    ? [['filter.location',`POINT(${venue.lon} ${venue.lat})`],['filter.location.radius',String(venue.radiusM)]]
    : [['filter.geocode.name',venue.city]];
}
export function scenario(){
  const request=structuredClone(scenarios[0].request) as BriefRequest;
  const queries=[request.headlinerQuery,...request.roster.map(r=>r.name)];
  const calls=queries.map((query,i)=>call(fixture(`fx-sg-indie/search-${i}.json`),[['query',query],['types','urn:entity:artist']],'/search',`C-search-${i}`));
  const evidence=resolveFromRecords({headlinerQuery:request.headlinerQuery,roster:request.roster},calls);
  const head=evidence.headliner.chosen!;
  const confirmed:ConfirmedResolutions={headliner:{entityId:head.entityId,name:head.name,receiptId:head.receiptId},roster:evidence.roster.map(r=>{
    const selected=r.target==='r2'?r.candidates[0]:r.target==='r7'?r.candidates[0]:r.chosen;
    return {rowId:r.target,entityId:selected?.entityId??null,name:selected?.name??null,receiptId:selected?.receiptId??null,status:selected?'user_confirmed':'not_found'};
  })};
  const rankingCall=call(fixture('fx-sg-indie/ranking.json'),[['filter.type','urn:entity:artist'],['filter.results.entities',scenarios[0].confirmedRosterIds.join(',')],['signal.interests.entities','fx-art-hl']],'/v2/insights','C-ranking');
  const rank=rankRosterEvidence(rankingCall,confirmed,request);
  const partners=(['brand','place','podcast'] as const).map(category=>buildShortlistEvidence(call(fixture(`fx-sg-indie/${category}.json`),[['filter.type',`urn:entity:${category}`],['signal.interests.entities','fx-art-hl'],...(category==='place'?placeParams(request.venue):[])],'/v2/insights',`C-${category}`),category,request.venue,[],'scripted',scenarios[0].confirmedRosterIds));
  return {request,confirmed,evidence,calls,rankingCall,ranking:rank.ranking,partners:partners.map(p=>p.shortlist),receipts:[...evidence.receipts,...rank.receipts,...partners.flatMap(p=>p.receipts)]};
}
