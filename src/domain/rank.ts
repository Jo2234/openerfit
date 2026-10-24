import type { BriefRequest, ConfirmedResolutions, OpenerRow, QlooCallRecord, Receipt, RosterRanking } from '../shared/types';
import { COPY } from '../shared/copy';
import { affinityReceipt, recordedEntities } from './receipts';
export interface RankingEvidence { ranking: RosterRanking; receipts: Receipt[] }
/** Exact numeric sorting; constraint eligibility never enters the comparator. */
export function rankRosterEvidence(call:QlooCallRecord,confirmed:ConfirmedResolutions,request:BriefRequest):RankingEvidence {
  if(call.endpoint!=='/v2/insights'||!call.params.some(([k,v])=>k==='filter.type'&&v==='urn:entity:artist'))throw new Error('Expected artist insights');
  const allowed=new Set(confirmed.roster.flatMap(r=>r.entityId?[r.entityId]:[]));
  const filter=new Set(call.params.find(([k])=>k==='filter.results.entities')?.[1].split(',')??[]);
  if([...allowed].some(id=>!filter.has(id))||!call.params.some(([k,v])=>k==='signal.interests.entities'&&v===confirmed.headliner.entityId))throw new Error('Ranking record context mismatch');
  const returned=recordedEntities(call);const first=new Map<string,typeof returned[number]>();const uncertainty:string[]=[];let outside=0;let duplicate=false;
  for(const row of returned){if(!allowed.has(row.identity.id)||!filter.has(row.identity.id)){outside++;continue;}if(first.has(row.identity.id)){duplicate=true;continue;}first.set(row.identity.id,row);}
  if(outside)uncertainty.push(`Qloo returned ${outside} result(s) outside the roster filter; they were ignored.`);
  if(duplicate)uncertainty.push('duplicate result IDs');if(!returned.length)uncertainty.push(COPY.emptyInsights);
  const receipts:Receipt[]=[];
  const rows:OpenerRow[]=request.roster.map(input=>{
    const resolution=confirmed.roster.find(r=>r.rowId===input.rowId);const result=resolution?.entityId?first.get(resolution.entityId):undefined;
    const receipt=result?affinityReceipt(call,result):null;if(receipt)receipts.push(receipt);
    const status=resolution?.status==='user_skipped'?'skipped':resolution?.status==='not_found'||!resolution?.entityId?'not_in_qloo':receipt?'ranked':'no_affinity_returned';
    const affinity=typeof receipt?.value==='number'?receipt.value:null;
    const withinBudget=input.feeAmount===null||request.budget.perOpenerMax===null?null:input.feeAmount<=request.budget.perOpenerMax;
    return {rowId:input.rowId,inputName:input.name,entityId:resolution?.entityId??null,qlooName:result?.identity.name??resolution?.name??null,status,affinity,affinityReceiptId:receipt?.id??null,affinityRank:null,qlooOrder:result?.index??null,outOfRange:affinity!==null&&(affinity<0||affinity>1),bookability:input.bookability,feeAmount:input.feeAmount,withinBudget,shortlistEligible:status==='ranked'&&input.bookability!=='unavailable'&&withinBudget!==false};
  });
  const priority={ranked:0,no_affinity_returned:1,not_in_qloo:2,skipped:3};
  rows.sort((a,b)=>priority[a.status]-priority[b.status]||(a.status==='ranked'&&b.status==='ranked'?(b.affinity!-a.affinity!)||(a.qlooOrder!-b.qlooOrder!)||(a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0):0));
  let rank=0;rows.forEach((row,i)=>{if(row.status==='ranked'){row.affinityRank=++rank;if(i&&rows[i-1].affinity===row.affinity)uncertainty.push(`${rows[i-1].qlooName} and ${row.qlooName} returned identical affinity (${row.affinity})`);}});
  if(rows.some(r=>r.outOfRange))uncertainty.push('affinity outside the documented 0–1 range');
  return {ranking:{headliner:{...confirmed.headliner},rows,recommendedRowIds:rows.filter(r=>r.shortlistEligible).slice(0,3).map(r=>r.rowId),rankingCallId:call.callId,uncertainty},receipts};
}
export function rankRoster(call:QlooCallRecord,confirmed:ConfirmedResolutions,request:BriefRequest):RosterRanking {return rankRosterEvidence(call,confirmed,request).ranking;}
