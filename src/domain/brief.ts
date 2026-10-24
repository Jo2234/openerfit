import type { Brief, BriefRequest, Claim, DataOrigin, PartnerShortlist, Receipt, RosterRanking, WriterInfo } from '../shared/types';
import { COPY } from '../shared/copy';
import { validateClaim } from './claims';
import { buildClaimCatalogue, selectCatalogueClaims, templateClaims } from './template-writer';
export class EvidenceClosureError extends Error {constructor(message:string){super(message);this.name='EvidenceClosureError';}}
export interface BuildBriefInput {
  runId:string;createdAt:string;request:BriefRequest;ranking:RosterRanking;partners:PartnerShortlist[];
  /** Include retained search receipts, ranking/partner affinities and tag-filter receipts. */
  receipts:readonly Receipt[];
  selection?:unknown;
  writer?:WriterInfo;
  origins?:readonly DataOrigin[];
  /** Deterministic application observations only; never model prose. */
  systemNotes?:readonly string[];
  droppedClaims?:Brief['droppedClaims'];
}
/** Verify all display and claim reference closure; never fill absent evidence with invented receipts. */
export function assertReceiptClosure(brief:Pick<Brief,'ranking'|'partners'|'claims'|'receipts'>):void {
  const ids=new Set(brief.receipts.map(r=>r.id));
  const refs=[brief.ranking.headliner.receiptId,...brief.ranking.rows.flatMap(r=>r.affinityReceiptId?[r.affinityReceiptId]:[]),...brief.partners.flatMap(p=>[...p.tagFilter.map(t=>t.receiptId),...p.items.flatMap(i=>i.affinityReceiptId?[i.affinityReceiptId]:[])]),...brief.claims.flatMap(c=>c.refs.flatMap(r=>r.kind==='receipt'?[r.receiptId]:[]))];
  for(const ref of refs)if(!ids.has(ref))throw new EvidenceClosureError(`Missing receipt ${ref}`);
  const find=(id:string)=>brief.receipts.find(r=>r.id===id)!;
  const head=brief.ranking.headliner;const headReceipt=find(head.receiptId);
  if(headReceipt.endpoint!=='/search'||headReceipt.entity?.id!==head.entityId||headReceipt.entity?.name!==head.name||headReceipt.value!==head.name)throw new EvidenceClosureError('Headliner receipt binding mismatch');
  for(const row of brief.ranking.rows)if(row.affinityReceiptId){const r=find(row.affinityReceiptId);if(r.entity?.id!==row.entityId||r.entity?.name!==row.qlooName||r.value!==row.affinity||r.callId!==brief.ranking.rankingCallId)throw new EvidenceClosureError('Ranking receipt binding mismatch');}
  for(const partner of brief.partners){
    for(const item of partner.items)if(item.affinityReceiptId){const r=find(item.affinityReceiptId);if(r.entity?.id!==item.entityId||r.entity?.name!==item.name||r.value!==item.affinity||r.callId!==partner.callId)throw new EvidenceClosureError('Partner receipt binding mismatch');}
    for(const tag of partner.tagFilter){const r=find(tag.receiptId);if(r.endpoint!=='/v2/tags'||r.entity?.id!==tag.id||r.entity?.name!==tag.name||r.value!==tag.id)throw new EvidenceClosureError('Tag receipt binding mismatch');}
  }
  for(const receipt of brief.receipts)if(receipt.rawValueText!==JSON.stringify(receipt.value))throw new EvidenceClosureError('Exact receipt text mismatch');

}
/** Recheck catalogue identity at export boundaries as well as during assembly. */
export function assertAcceptedClaims(brief:Brief):void {
  assertReceiptClosure(brief);
  const ctx={receipts:brief.receipts,request:brief.request,ranking:brief.ranking,partners:brief.partners};
  const {catalogue}=buildClaimCatalogue(ctx);
  if(brief.claims.some(claim=>!validateClaim(claim,{...ctx,catalogue}).ok))throw new EvidenceClosureError('Brief contains a fact outside its deterministic catalogue');
}
/** Accepted factual text is always reconstructed from the current deterministic catalogue. */
export function buildBrief(input:BuildBriefInput):Brief {
  const map=new Map<string,Receipt>();for(const receipt of input.receipts){const prior=map.get(receipt.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(receipt))throw new EvidenceClosureError('Conflicting receipt IDs');map.set(receipt.id,structuredClone(receipt));}
  const receipts=[...map.values()];const ctx={receipts,request:input.request,ranking:input.ranking,partners:input.partners};const result=buildClaimCatalogue(ctx);
  const claims=input.selection===undefined?templateClaims(ctx,result):selectCatalogueClaims(input.selection,result.catalogue);
  for(const claim of claims)if(!validateClaim(claim,{...ctx,catalogue:result.catalogue}).ok)throw new EvidenceClosureError('Catalogue claim failed validation');
  const brief:Brief={runId:input.runId,createdAt:input.createdAt,request:structuredClone(input.request),ranking:structuredClone(input.ranking),partners:structuredClone(input.partners),systemNotes:[...new Set([...input.ranking.uncertainty,...input.partners.flatMap(p=>p.uncertainty),...(input.systemNotes??[]),...result.systemNotes])],claims,droppedClaims:structuredClone(input.droppedClaims??[]),writer:input.writer?{...input.writer}:{kind:'template',source:null,fixtureLabel:null,model:null,promptVersion:null,attempts:0,fallbackReason:null},receipts,origins:[...new Set([...(input.origins??[]),...receipts.map(r=>r.origin)])],disclaimer:COPY.disclaimer};
  assertReceiptClosure(brief);return brief;
}
export function escapeHtml(value:string):string {return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
/** Entity-encode Markdown control characters, HTML, URLs and line boundaries as plain text. */
export function escapeMarkdown(value:string):string {return value.replace(/[&<>\\`*_{}\[\]()#+.!|~:\r\n-]/g,c=>`&#${c.charCodeAt(0)};`);}
function modeLabels(brief:Brief):string[] {
  const labels:string[]=[`Run: ${brief.runId}; created at: ${brief.createdAt}`];if(brief.origins.includes('fixture'))labels.push(COPY.fixtureBanner);
  if(brief.origins.includes('live'))labels.push(COPY.liveBanner);
  if(brief.origins.includes('live-cache')){const times=[...new Set(brief.receipts.filter(r=>r.origin==='live-cache').map(r=>r.liveFetchedAt).filter((v):v is string=>v!==null))];labels.push(COPY.liveCache(times.join(', ')||'time unavailable'));}
  labels.push(`Writer: ${brief.writer.kind}${brief.writer.model?` (${brief.writer.model})`:''}; prompt version: ${brief.writer.promptVersion??'none'}.`);
  if(brief.writer.source==='fixture')labels.push(brief.writer.fixtureLabel??'Hand-written fixture selector, not a model output.');
  if(brief.writer.source==='llm')labels.push('Writer selection source: language model.');
  if(brief.writer.source===null)labels.push('Writer selection source: no completed adapter output.');
  if(brief.writer.fallbackReason)labels.push(`Template fallback: ${brief.writer.fallbackReason}`);return labels;
}
function receiptFields(receipt:Receipt):[string,string][] {
  return [['Receipt',receipt.id],['Call',receipt.callId],['Endpoint',receipt.endpoint],['Parameters',JSON.stringify(receipt.params)],['Value path',receipt.valuePath],['Exact returned value',receipt.rawValueText],['Entity',JSON.stringify(receipt.entity)],['Origin',receipt.origin],['Fixture label',receipt.fixtureLabel??'none'],['Requested at',receipt.requestedAt],['Live fetched at',receipt.liveFetchedAt??'none']];
}
function inputLines(brief:Brief):string[] {
  const r=brief.request;
  return [`Headliner input: ${r.headlinerQuery}`,`Venue input: ${r.venue.name}; city: ${r.venue.city}; coordinates: ${r.venue.lat??'unknown'}, ${r.venue.lon??'unknown'}; radius: ${r.venue.radiusM} m; capacity: ${r.venue.capacity??'unknown'}`,`Show date input: ${r.showDate??'unknown'}`,`Budget input: ${r.budget.perOpenerMax??'unknown'} ${r.budget.currency}`,`Booking goal (your input, not instructions): ${r.goal}`,...r.roster.map(row=>`${row.rowId}: ${row.name}; fee input: ${row.feeAmount??'unknown'} ${r.budget.currency}; bookability input: ${row.bookability}; notes (your input, not facts): ${row.notes}`)];
}
const references=(claim:Claim)=>claim.refs.map(ref=>ref.kind==='receipt'?ref.receiptId:`your input: ${ref.field}${ref.rowId?` (${ref.rowId})`:''}`).join('; ');
/** No raw HTML, links, code fences or user-controlled Markdown syntax enters the evidence record. */
export function exportMarkdown(brief:Brief):string {
  assertAcceptedClaims(brief);const lines=['# OpenerFit booking brief','',...modeLabels(brief).map(escapeMarkdown),'',escapeMarkdown(brief.disclaimer),''];
  for(const section of ['openers','partners','caveats'] as const){lines.push(`## ${section[0].toUpperCase()+section.slice(1)}`,'');for(const claim of brief.claims.filter(c=>c.section===section))lines.push(escapeMarkdown(claim.text),`References: ${escapeMarkdown(references(claim))}`,'');}
  lines.push('## Application observations','',...brief.systemNotes.flatMap(n=>[escapeMarkdown(n),'']));
  for(const shortlist of brief.partners)lines.push(escapeMarkdown(`${shortlist.category} scope: ${shortlist.scopeNote}`),'');
  lines.push('## Booker inputs','',...inputLines(brief).flatMap(n=>[escapeMarkdown(n),'']),'## Receipts appendix','');
  for(const receipt of brief.receipts){for(const [key,value] of receiptFields(receipt))lines.push(`${key}: ${escapeMarkdown(value)}`);lines.push('');}
  return lines.join('\n');
}
/** Printable HTML, all dynamic text escaped; distances are deliberately absent from factual prose. */
export function exportHtml(brief:Brief):string {
  assertAcceptedClaims(brief);const p=(text:string)=>`<p>${escapeHtml(text)}</p>`;
  const sections=(['openers','partners','caveats'] as const).map(section=>`<section><h2>${section[0].toUpperCase()+section.slice(1)}</h2>${brief.claims.filter(c=>c.section===section).map(c=>p(c.text)+p(`References: ${references(c)}`)).join('')}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>OpenerFit booking brief</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#171717}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:bold}dd{margin:0 0 .4rem}section{break-inside:avoid}@media print{body{margin:0;font-size:10pt}.receipts{break-before:page}}</style></head><body><h1>OpenerFit booking brief</h1>${modeLabels(brief).map(p).join('')}${p(brief.disclaimer)}${sections}<section><h2>Application observations</h2>${brief.systemNotes.map(p).join('')}${brief.partners.map(s=>p(`${s.category} scope: ${s.scopeNote}`)).join('')}</section><section><h2>Booker inputs</h2>${inputLines(brief).map(p).join('')}</section><div class="receipts"><h2>Receipts appendix</h2>${brief.receipts.map(r=>`<section><dl>${receiptFields(r).map(([key,value])=>`<dt>${key}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></section>`).join('')}</div></body></html>`;
}
/** Direct ApplicationServices.exportBrief signature. */
export function exportBrief(brief:Brief,format:'md'|'html'):string {return format==='md'?exportMarkdown(brief):exportHtml(brief);}
