import type { BriefRequest, Claim, ClaimCatalogueEntry, ClaimCheck, ClaimRef, ClaimViolation, PartnerShortlist, Receipt, RosterRanking } from '../shared/types';
export const COPY_RULE_LEXICON:readonly {id:string;pattern:RegExp}[] = [
  {id:'L01',pattern:/ticket sales|sell(?:s|ing)?[ -]?out|sold[ -]?out|box office/i},
  {id:'L02',pattern:/revenue|profit|gross|\bROI\b|earn(?:s|ings)?/i},
  {id:'L03',pattern:/demand|will draw|draw(?:s)? a crowd|attendance|turnout|footfall/i},
  {id:'L04',pattern:/guarantee[sd]?|certain(?:ly)? to|will definitely|proven to/i},
  {id:'L05',pattern:/\d+(?:\.\d+)?\s?%|percent|probabilit|likelihood|odds|chance of/i},
  {id:'L06',pattern:/demographic|\bgen[ -]?z\b|millennial|boomer|\bwomen\b|\bmen\b|\bmale\b|\bfemale\b|aged \d|ages? \d|income/i},
  {id:'L07',pattern:/available on|is available|confirmed (?:for|to play)|has agreed/i},
  {id:'L08',pattern:/fans will (?:love|buy)|everyone loves|best (?:opener|choice)/i},
];
export interface ClaimContext {
  receipts: readonly Receipt[];
  request: BriefRequest;
  ranking: RosterRanking;
  partners: readonly PartnerShortlist[];
  knownNames?: readonly string[];
  /** Required at acceptance; omission runs only the defense-in-depth lexical checks. */
  catalogue?: readonly ClaimCatalogueEntry[];
}
export function userField(ref:Extract<ClaimRef,{kind:'user_input'}>,request:BriefRequest):string|number|null {
  const row=request.roster.find(r=>r.rowId===ref.rowId);
  switch(ref.field){case 'fee':return row?.feeAmount??null;case 'bookability':return row?.bookability??null;case 'notes':return row?.notes||null;
    case 'budget':return ref.rowId===null?request.budget.perOpenerMax:null;case 'capacity':return ref.rowId===null?request.venue.capacity:null;case 'show_date':return ref.rowId===null?request.showDate:null;}
}
const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Diagnostics alone do not prove entailment. Accepted claims also require exact catalogue identity. */
export function checkClaimText(claim:Claim,ctx:ClaimContext):ClaimCheck {
  const violations:ClaimViolation[]=[];const add=(rule:ClaimViolation['rule'],detail:string,lexiconId?:string)=>violations.push({rule,detail,...(lexiconId?{lexiconId}:{})});
  if(!claim.text.trim())add('EMPTY','Claim text is empty');if(claim.text.length>280)add('TOO_LONG','Claim exceeds 280 characters');if(!claim.refs.length)add('NO_REFS','Claim has no references');
  const cited:Receipt[]=[];const inputs:Extract<ClaimRef,{kind:'user_input'}>[]=[];
  for(const ref of claim.refs){if(ref.kind==='receipt'){const receipt=ctx.receipts.find(r=>r.id===ref.receiptId);if(!receipt)add('UNKNOWN_RECEIPT',ref.receiptId);else cited.push(receipt);}else{inputs.push(ref);if(userField(ref,ctx.request)===null)add('USER_FIELD_MISSING',`${ref.field}:${ref.rowId??'global'}`);}}
  const names=[...new Set([...(ctx.knownNames??[]),...ctx.receipts.flatMap(r=>r.entity?[r.entity.name]:[]),...ctx.request.roster.map(r=>r.name),ctx.ranking.headliner.name])].filter(Boolean).sort((a,b)=>b.length-a.length);
  let residue=claim.text;
  for(const name of names){const re=new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`,'giu');
    if(re.test(residue)){const allowed=name===ctx.ranking.headliner.name||cited.some(r=>r.entity?.name===name)||ctx.request.roster.some(r=>r.name===name&&inputs.some(ref=>ref.rowId===r.rowId));if(!allowed)add('ENTITY_NOT_IN_REFS',name);residue=residue.replace(re,' ');}}
  const numeric: number[]=[];
  for(const receipt of cited)if(typeof receipt.value==='number')numeric.push(receipt.value,Number(receipt.value.toFixed(2)),Number(receipt.value.toFixed(3)));
  for(const ref of inputs){const value=userField(ref,ctx.request);if(typeof value==='number')numeric.push(value,Number(value.toFixed(2)));else if(ref.field==='show_date'&&value)numeric.push(...value.split('-').map(Number));}
  // Only actual rank syntax can cite a derived ordinal; a bare number cannot borrow a rank.
  residue=residue.replace(/#(\d+)\b|\b(\d+)(?:st|nd|rd|th)\b/g,(token,a,b)=>{
    const n=Number(a??b);if(!ctx.ranking.rows.some(row=>row.affinityRank===n&&cited.some(r=>r.id===row.affinityReceiptId)))add('NUMBER_NOT_IN_REFS',token);return ' ';});
  // Date components are unsigned; all other numeric tokens retain signs/exponents.
  if(inputs.some(ref=>ref.field==='show_date'&&userField(ref,ctx.request)===ctx.request.showDate)&&ctx.request.showDate)residue=residue.replaceAll(ctx.request.showDate,' ');
  for(const token of residue.match(/[+-]?\d+(?:[.,]\d+)*(?:e[+-]?\d+)?/gi)??[]){if(!numeric.includes(Number(token.replace(/,/g,''))))add('NUMBER_NOT_IN_REFS',token);}
  for(const lexicon of COPY_RULE_LEXICON){if(!lexicon.pattern.test(claim.text))continue;
    const available=lexicon.id==='L07'&&inputs.some(ref=>ref.field==='bookability'&&userField(ref,ctx.request)==='available'&&ctx.request.roster.some(r=>r.rowId===ref.rowId&&claim.text.includes(r.name)));
    if(!available)add('FORBIDDEN_CLAIM','Copy rule violation',lexicon.id);}
  if(ctx.catalogue&&!ctx.catalogue.some(entry=>entry.id===claim.id&&entry.section===claim.section&&entry.text===claim.text&&claim.author==='template'&&JSON.stringify(entry.refs)===JSON.stringify(claim.refs)))add('FORBIDDEN_CLAIM','Claim is not an exact fact from this run’s deterministic catalogue');
  return {claimId:claim.id,ok:violations.length===0,violations};
}

export type ClaimAcceptanceContext=ClaimContext & {catalogue:readonly ClaimCatalogueEntry[]};
/** Acceptance validator: exact catalogue membership is mandatory in addition to diagnostics. */
export function validateClaim(claim:Claim,ctx:ClaimAcceptanceContext):ClaimCheck {
  const check=checkClaimText(claim,ctx);
  if(!ctx.catalogue){check.violations.push({rule:'FORBIDDEN_CLAIM',detail:'Acceptance requires this run’s deterministic catalogue'});check.ok=false;}
  return check;
}
