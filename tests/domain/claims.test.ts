import { expect,test } from 'vitest';
import type { Claim, ClaimRef } from '../../src/shared/types';
import { checkClaimText,validateClaim } from '../../src/domain/claims';
import { buildClaimCatalogue,selectCatalogueClaims } from '../../src/domain/template-writer';
import { buildBrief } from '../../src/domain/brief';
import { scenario } from './helpers';
const claim=(text:string,refs:ClaimRef[],id='test'):Claim=>({id,section:'openers',text,refs,author:'template'});
const ref=(receiptId:string):ClaimRef=>({kind:'receipt',receiptId});
test('D6: numeric/rank/entity diagnostics independently reject mismatches',()=>{
  const s=scenario();const row=s.ranking.rows[0];const refs=[ref(row.affinityReceiptId!)];
  const rules=(text:string)=>checkClaimText(claim(text,refs),s).violations.map(v=>v.rule);
  expect(checkClaimText(claim('Saltwater Static has affinity 0.913',refs),s).ok).toBe(true);
  expect(rules('Saltwater Static has affinity 0.92')).toContain('NUMBER_NOT_IN_REFS');
  expect(rules('Kopi Noir (0.874) has affinity')).toEqual(expect.arrayContaining(['NUMBER_NOT_IN_REFS','ENTITY_NOT_IN_REFS']));
  expect(checkClaimText(claim('Saltwater Static is #1',refs),s).ok).toBe(true);expect(rules('Saltwater Static is #2')).toContain('NUMBER_NOT_IN_REFS');
  expect(rules('Saltwater Static has affinity -0.913')).toContain('NUMBER_NOT_IN_REFS');
});
test('D6: lexicon, length, missing input/receipt and fee checks are independent',()=>{
  const s=scenario();const refs=[ref(s.ranking.rows[0].affinityReceiptId!)];
  for(const [text,id] of [['91% match','L05'],['will draw a crowd','L03'],['popular with women aged 25','L06'],['is available on the date','L07']])expect(checkClaimText(claim(text,refs),s).violations.some(v=>v.lexiconId===id)).toBe(true);
  expect(checkClaimText(claim('x',[ref('R-doesnotexist')]),s).violations.map(v=>v.rule)).toContain('UNKNOWN_RECEIPT');
  expect(checkClaimText(claim('x',[]),s).violations.map(v=>v.rule)).toContain('NO_REFS');expect(checkClaimText(claim('x'.repeat(281),refs),s).violations.map(v=>v.rule)).toContain('TOO_LONG');
  const fee:ClaimRef[]=[{kind:'user_input',field:'fee',rowId:'r1'}];expect(checkClaimText(claim('Saltwater Static fee 1200 SGD',fee),s).ok).toBe(true);expect(checkClaimText(claim('Saltwater Static fee 1300 SGD',fee),s).violations.map(v=>v.rule)).toContain('NUMBER_NOT_IN_REFS');
  expect(checkClaimText(claim('unknown',[{kind:'user_input',field:'fee',rowId:'r7'}]),s).violations.map(v=>v.rule)).toContain('USER_FIELD_MISSING');
});
test('D6: catalogue acceptance rejects unsupported relation even with valid numbers/refs',()=>{
  const s=scenario();const {catalogue}=buildClaimCatalogue(s);const fact=catalogue.find(c=>c.section==='openers')!;
  expect(validateClaim(fact,{...s,catalogue}).ok).toBe(true);
  const forged={...fact,text:'Saltwater Static is 0.913 metres from the venue.'};expect(validateClaim(forged,{...s,catalogue}).ok).toBe(false);
  expect(()=>selectCatalogueClaims({claimIds:[fact.id],claims:[forged]},catalogue)).toThrow();expect(()=>selectCatalogueClaims({claimIds:['fact-forged']},catalogue)).toThrow();expect(()=>selectCatalogueClaims({claimIds:[fact.id,fact.id]},catalogue)).toThrow();
  const brief=buildBrief({...s,runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z',selection:{claimIds:[fact.id]},writer:{kind:'llm',source:'llm',fixtureLabel:null,model:'synthetic-model',promptVersion:'ofv1.1',attempts:1,fallbackReason:null}});
  expect(brief.claims).toEqual([fact]);expect(brief.claims[0].author).toBe('template');
});
test('D6: availability is always the actual input state; an unrelated row cannot authorize it',()=>{
  const s=scenario();const {catalogue}=buildClaimCatalogue(s);
  expect(catalogue.find(c=>c.text==='You marked Paper Lantern Club bookability as unavailable.')?.refs).toEqual([{kind:'user_input',field:'bookability',rowId:'r4'}]);
  expect(catalogue.find(c=>c.text==='You marked Lantern Choir bookability as unknown.')?.refs).toEqual([{kind:'user_input',field:'bookability',rowId:'r5'}]);
  for(const rowId of ['r4','r5'])expect(checkClaimText(claim(`${s.request.roster.find(r=>r.rowId===rowId)!.name} is available on the date`,[{kind:'user_input',field:'bookability',rowId}]),{...s,catalogue}).ok).toBe(false);
  expect(checkClaimText(claim('Saltwater Static is available on the date',[{kind:'user_input',field:'bookability',rowId:'r1'}]),s).ok).toBe(true);
  expect(checkClaimText(claim('Paper Lantern Club is available on the date',[{kind:'user_input',field:'bookability',rowId:'r1'}]),{...s,catalogue}).ok).toBe(false);
});
test('D6: same number from a different entity/path/call cannot enter a catalogue fact',()=>{
  const s=scenario();const correct=s.receipts.find(r=>r.id===s.ranking.rows[0].affinityReceiptId)!;
  for(const bad of [{...correct,entity:{id:'fx-other',name:'Saltwater Static',subtype:null}},{...correct,value:0.92},{...correct,valuePath:'results.entities[0].popularity'},{...correct,callId:'C-other'}]){
    const changed={...s,receipts:s.receipts.map(r=>r.id===correct.id?bad:r)};expect(buildClaimCatalogue(changed).catalogue.some(c=>c.section==='openers'&&c.text.startsWith('Saltwater Static has'))).toBe(false);
  }
});
