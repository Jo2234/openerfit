import type { BaselineDiff, BaselineOutput, BriefRequest, PartnerCategory, PartnerShortlist, RosterRanking } from '../shared/types';
import { normalize } from './normalize';
import { COPY_RULE_LEXICON } from './claims';
/** Kendall tau-b; input pairs are baseline position and distinct affinity ordinal. */
export function kendallTau(pairs:readonly (readonly [number,number])[]):number|null {
  if(pairs.length<2)return null;let concordant=0,discordant=0,tiesX=0,tiesY=0;
  for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
    const x=Math.sign(pairs[i][0]-pairs[j][0]),y=Math.sign(pairs[i][1]-pairs[j][1]);
    if(!x&&!y)continue;if(!x)tiesX++;else if(!y)tiesY++;else if(x===y)concordant++;else discordant++;
  }
  const denom=Math.sqrt((concordant+discordant+tiesX)*(concordant+discordant+tiesY));
  return denom?(concordant-discordant)/denom:null;
}
/** Matched positions count all roster identities, including acts without Qloo affinity. */
export function diffBaseline(output:BaselineOutput,request:BriefRequest,ranking:RosterRanking,shortlists:readonly PartnerShortlist[]):BaselineDiff {
  const roster=new Map(request.roster.map(r=>[normalize(r.name),r]));const positions=new Map<string,number>();const baselineNotInRoster:string[]=[];const seen=new Set<string>();let position=0;
  for(const name of output.openerRanking){const key=normalize(name);if(seen.has(key))continue;seen.add(key);const row=roster.get(key);if(!row){baselineNotInRoster.push(name);continue;}positions.set(row.rowId,++position);}
  const rows=ranking.rows.map(row=>{const baselinePos=positions.get(row.rowId)??null;return {rowId:row.rowId,name:row.inputName,baselinePos,qlooRank:row.affinityRank,delta:baselinePos!==null&&row.affinityRank!==null?baselinePos-row.affinityRank:null};});
  const partners={} as BaselineDiff['partners'];
  for(const category of ['brand','place','podcast'] as PartnerCategory[]){const names=new Set(shortlists.filter(p=>p.category===category).flatMap(p=>p.items.map(i=>normalize(i.name))));const matchedQloo:string[]=[],noReceipt:string[]=[];const seenNames=new Set<string>();
    for(const name of output.partners[category]){const key=normalize(name);if(seenNames.has(key))continue;seenNames.add(key);(names.has(key)?matchedQloo:noReceipt).push(name);}partners[category]={matchedQloo,noReceipt};}
  return {rows,kendallTau:kendallTau(rows.flatMap(r=>r.baselinePos!==null&&r.qlooRank!==null?[[r.baselinePos,r.qlooRank] as const]:[])),changedPositions:rows.filter(r=>r.delta!==null&&r.delta!==0).length,baselineNotInRoster,partners,baselineCopyViolations:output.rationale.flatMap(text=>COPY_RULE_LEXICON.filter(l=>l.pattern.test(text)).map(l=>({text,lexiconId:l.id})))};
}
