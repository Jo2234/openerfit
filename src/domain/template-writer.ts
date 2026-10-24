import { createHash } from 'node:crypto';
import type { Claim, ClaimCatalogueEntry, ClaimRef, Receipt } from '../shared/types';
import { type ClaimContext, checkClaimText } from './claims';
export type CatalogueContext=Omit<ClaimContext,'catalogue'>;
export interface CatalogueResult { catalogue:ClaimCatalogueEntry[]; systemNotes:string[] }
const receiptRef=(receiptId:string):ClaimRef=>({kind:'receipt',receiptId});
const inputRef=(field:'fee'|'budget'|'bookability',rowId:string|null):ClaimRef=>({kind:'user_input',field,rowId});
const factId=(kind:string,key:string)=>`fact-${kind}-${createHash('sha256').update(key).digest('hex').slice(0,16)}`;
const amount=(n:number)=>Number.isInteger(n)?String(n):n.toFixed(2);
const hasParam=(receipt:Receipt,key:string,value:string)=>receipt.params.some(([k,v])=>k===key&&v===value);
function boundReceipt(receipts:readonly Receipt[],id:string|null,entityId:string|null,name:string|null,value:number|null):Receipt|null {
  const receipt=receipts.find(r=>r.id===id);
  return receipt&&receipt.endpoint==='/v2/insights'&&receipt.entity?.id===entityId&&receipt.entity?.name===name&&typeof value==='number'&&Number.isFinite(value)&&receipt.value===value&&/(?:\.query)?\.affinity$/.test(receipt.valuePath)?receipt:null;
}
/** Finite deterministic facts only. Notes/goal never enter the catalogue. Total for hostile names. */
export function buildClaimCatalogue(ctx:CatalogueContext):CatalogueResult {
  const catalogue:ClaimCatalogueEntry[]=[];const systemNotes:string[]=[];
  const add=(kind:string,key:string,section:Claim['section'],text:string,refs:ClaimRef[])=>{
    const claim:ClaimCatalogueEntry={id:factId(kind,key),section,text,refs,author:'template'};
    const check=checkClaimText(claim,ctx);
    if(check.ok)catalogue.push(claim);else systemNotes.push(`Omitted unsupported catalogue fact ${claim.id}: ${[...new Set(check.violations.map(v=>v.rule))].join(', ')}.`);
  };
  const head=ctx.receipts.find(r=>r.id===ctx.ranking.headliner.receiptId);
  const headBound=head?.endpoint==='/search'&&head.entity?.id===ctx.ranking.headliner.entityId&&head.entity?.name===ctx.ranking.headliner.name&&head.value===ctx.ranking.headliner.name;
  for(const row of ctx.ranking.rows){
    const receipt=boundReceipt(ctx.receipts,row.affinityReceiptId,row.entityId,row.qlooName,row.affinity);
    if(row.status==='ranked'){
      if(receipt&&receipt.callId===ctx.ranking.rankingCallId&&headBound&&row.affinityRank!==null&&hasParam(receipt,'filter.type','urn:entity:artist')&&hasParam(receipt,'signal.interests.entities',ctx.ranking.headliner.entityId)&&receipt.params.some(([k,v])=>k==='filter.results.entities'&&v.split(',').includes(row.entityId!))){
        const prefix=receipt.origin==='fixture'?'Synthetic fixture affinity':'Qloo affinity';
        add('opener',row.rowId,'openers',`${row.qlooName} has the #${row.affinityRank} ${prefix} to ${ctx.ranking.headliner.name} in your roster (${row.affinity!.toFixed(3)}).`,[receiptRef(receipt.id),receiptRef(ctx.ranking.headliner.receiptId)]);
      }else systemNotes.push(`Omitted unsupported affinity fact for roster row ${row.rowId}.`);
    }
    const input=ctx.request.roster.find(r=>r.rowId===row.rowId);if(!input)continue;
    add('bookability',input.rowId,'caveats',`You marked ${input.name} bookability as ${input.bookability}.`,[inputRef('bookability',input.rowId)]);
    if(input.feeAmount!==null){
      const budget=ctx.request.budget.perOpenerMax;
      if(budget!==null&&input.feeAmount>budget)add('budget',input.rowId,'caveats',`Your input fee for ${input.name} is ${amount(input.feeAmount)} ${ctx.request.budget.currency}, above your ${amount(budget)} ${ctx.request.budget.currency} opener budget.`,[inputRef('fee',input.rowId),inputRef('budget',null)]);
      else add('fee',input.rowId,'caveats',`Your input fee for ${input.name} is ${amount(input.feeAmount)} ${ctx.request.budget.currency}.`,[inputRef('fee',input.rowId)]);
    }
  }
  for(const shortlist of ctx.partners)for(const item of shortlist.items){
    const receipt=boundReceipt(ctx.receipts,item.affinityReceiptId,item.entityId,item.name,item.affinity);
    if(item.affinity===null)continue;
    if(!receipt||receipt.callId!==shortlist.callId||!headBound||!hasParam(receipt,'filter.type',`urn:entity:${shortlist.category}`)||!hasParam(receipt,'signal.interests.entities',ctx.ranking.headliner.entityId)){systemNotes.push(`Omitted unsupported ${shortlist.category} affinity fact at result ${item.qlooOrder}.`);continue;}
    const label=receipt.origin==='fixture'?'synthetic fixture affinity':'Qloo affinity';
    add('partner',`${shortlist.category}:${item.entityId}`,'partners',`${item.name}: ${shortlist.category} with ${label} ${item.affinity.toFixed(3)} to ${ctx.ranking.headliner.name}'s audience.`,[receiptRef(receipt.id),receiptRef(ctx.ranking.headliner.receiptId)]);
  }
  return {catalogue,systemNotes};
}
/** Bounded fallback reserves constraint caveats, then balances partner categories (max 12). */
export function templateClaims(ctx:CatalogueContext,result:CatalogueResult=buildClaimCatalogue(ctx)):ClaimCatalogueEntry[] {
  const byId=new Map(result.catalogue.map(c=>[c.id,c]));const selected:ClaimCatalogueEntry[]=[];
  const add=(id:string)=>{const fact=byId.get(id);if(fact&&!selected.some(c=>c.id===id)&&selected.length<12)selected.push(fact);};
  for(const rowId of ctx.ranking.recommendedRowIds)add(factId('opener',rowId));
  const lastRank=Math.max(0,...ctx.ranking.rows.filter(r=>ctx.ranking.recommendedRowIds.includes(r.rowId)).map(r=>r.affinityRank??0));
  for(const row of ctx.ranking.rows){
    if(row.status==='ranked'&&!row.shortlistEligible&&(row.affinityRank??Infinity)<lastRank){
      if(row.bookability==='unavailable')add(factId('bookability',row.rowId));
      if(row.withinBudget===false)add(factId('budget',row.rowId));
    }
    if(ctx.ranking.recommendedRowIds.includes(row.rowId)&&row.bookability==='unknown')add(factId('bookability',row.rowId));
  }
  // Round-robin coverage gives every category a first fact before any gets its second.
  for(let i=0;i<3;i++)for(const p of ctx.partners){const item=p.items.filter(item=>item.affinity!==null)[i];if(item)add(factId('partner',`${p.category}:${item.entityId}`));}
  for(const c of result.catalogue)if(c.section==='caveats')add(c.id);
  const order={openers:0,partners:1,caveats:2};return selected.sort((a,b)=>order[a.section]-order[b.section]);
}
export class ClaimSelectionError extends Error {constructor(message:string){super(message);this.name='ClaimSelectionError';}}
/** Model may choose IDs only. Reject duplicates, extra prose/fields and forged IDs atomically. */
export function selectCatalogueClaims(selection:unknown,catalogue:readonly ClaimCatalogueEntry[]):ClaimCatalogueEntry[] {
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).length!==1||!Object.hasOwn(selection,'claimIds'))throw new ClaimSelectionError('Expected claimIds only');
  const ids=(selection as {claimIds:unknown}).claimIds;
  if(!Array.isArray(ids)||ids.length>12||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new ClaimSelectionError('Invalid claim ID selection');
  const map=new Map(catalogue.map(c=>[c.id,c]));
  return ids.map(id=>{const claim=map.get(id);if(!claim)throw new ClaimSelectionError('Unknown catalogue ID');return structuredClone(claim);});
}
