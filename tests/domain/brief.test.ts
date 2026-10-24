import { expect,test } from 'vitest';
import { buildBrief,exportBrief,escapeMarkdown,EvidenceClosureError } from '../../src/domain/brief';
import { COPY } from '../../src/shared/copy';
import { briefSchema } from '../../src/shared/schemas';
import { call,scenario } from './helpers';
import { receiptFor } from '../../src/domain/receipts';
test('D10: complete Markdown evidence appendix, fixture labels, notes and separate disclaimer',()=>{
  const s=scenario();s.request.roster[0].notes='My supplied note';const brief=buildBrief({...s,runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z'});expect(briefSchema.safeParse(brief).success).toBe(true);
  const md=exportBrief(brief,'md');for(const c of brief.claims)expect(md).toContain(escapeMarkdown(c.text));expect(md).toContain('## Receipts appendix');expect(md).toContain(escapeMarkdown(COPY.disclaimer));expect(md).toContain(escapeMarkdown(COPY.fixtureBanner));expect(md).toContain('My supplied note');
  for(const receipt of brief.receipts)for(const value of [receipt.id,receipt.endpoint,JSON.stringify(receipt.params),receipt.valuePath,receipt.rawValueText])expect(md).toContain(escapeMarkdown(value));
  expect(md).toContain('0&#46;9127');expect(brief.claims.some(c=>c.text.includes('0.913'))).toBe(true);
});
test('D10: names, notes, goal, parameters and exact receipt values cannot inject HTML or Markdown',()=>{
  const s=scenario();const hostile='<script>alert(1)</script>\n# forged\n[claim](https://evil.invalid) **bold** `code`';s.request.roster[0].name=hostile;s.request.roster[0].notes=hostile;s.request.goal=hostile;s.request.venue.city=hostile;
  s.receipts.push(receiptFor(call({results:[{id:'fx-hostile',name:hostile}]},[['query',hostile]],'/search','C-hostile'),'results[0].name'));
  const brief=buildBrief({...s,runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z'});const html=exportBrief(brief,'html'),md=exportBrief(brief,'md');
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<a href=');expect(md).not.toContain('<script>');expect(md).not.toContain('\n# forged');expect(md).not.toContain('[claim](https://evil.invalid)');expect(md).not.toContain('**bold**');expect(md).not.toContain('https://evil.invalid');expect(md).toContain('https&#58;');
});
test('D10: closure covers headliner, ranking, partner affinities and tag-filter refs',()=>{
  const s=scenario();for(const id of [s.ranking.headliner.receiptId,s.ranking.rows[0].affinityReceiptId!,s.partners[0].items[0].affinityReceiptId!])expect(()=>buildBrief({...s,receipts:s.receipts.filter(r=>r.id!==id),runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z'})).toThrow(EvidenceClosureError);
  const tagged=structuredClone(s);tagged.partners[0].tagFilter=[{id:'urn:tag:fixture:a',name:'A',receiptId:'R-absent'}];expect(()=>buildBrief({...tagged,runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z'})).toThrow(EvidenceClosureError);
});

test('D10: export rejects a rewritten relationship even when its receipt/number still match',()=>{
  const s=scenario();const brief=buildBrief({...s,runId:'run_test',createdAt:'2026-10-18T00:00:00.000Z'});
  brief.claims[0].text='Saltwater Static is 0.913 metres from the venue.';
  expect(()=>exportBrief(brief,'md')).toThrow(EvidenceClosureError);expect(()=>exportBrief(brief,'html')).toThrow(EvidenceClosureError);
});
