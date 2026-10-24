import { expect,test } from 'vitest';
import { diffBaseline,kendallTau } from '../../src/domain/baseline-diff';
import { scenario } from './helpers';
const output={openerRanking:['Kopi Noir','Neon Durian','Saltwater Static','Echo Park Ferry','Velvet Monsoon','Moth Parade','Lantern Choir','Paper Lantern Club','The Strokes Tribute Band'],partners:{brand:['Tidewater Cold Brew','Generic Energy Drink Co.'],place:['Rooftop Bar Downtown'],podcast:['Night Bus Radio']},rationale:['Kopi Noir will help sell out the room.']};
test('D8: fixture identity/order expectations, six moved positions and hand-counted tau-b 0.2',()=>{
  const s=scenario();const diff=diffBaseline(output,s.request,s.ranking,s.partners);
  expect(diff.rows.map(r=>[r.rowId,r.baselinePos,r.qlooRank,r.delta])).toEqual([['r1',3,1,2],['r3',1,2,-1],['r4',8,3,5],['r2',6,4,2],['r5',7,5,2],['r7',5,6,-1],['r6',2,null,null],['r8',4,null,null]]);
  // Qloo rank order baseline positions [3,1,8,6,7,5]: 6 discordant, 9 concordant; (9-6)/15 = .2.
  expect(diff.changedPositions).toBe(6);expect(diff.kendallTau).toBe(0.2);expect(diff.baselineNotInRoster).toEqual(['The Strokes Tribute Band']);
  expect(diff.partners).toEqual({brand:{matchedQloo:['Tidewater Cold Brew'],noReceipt:['Generic Energy Drink Co.']},place:{matchedQloo:[],noReceipt:['Rooftop Bar Downtown']},podcast:{matchedQloo:['Night Bus Radio'],noReceipt:[]}});expect(diff.baselineCopyViolations).toEqual([{text:'Kopi Noir will help sell out the room.',lexiconId:'L01'}]);
});
test('D8: normalized duplicates first wins; unknowns separated and no affinity retains position',()=>{
  const s=scenario();const diff=diffBaseline({...output,openerRanking:['Unknown','The Saltwater Static!','saltwater static','Neon Durian','Kopi Noir','UNKNOWN']},s.request,s.ranking,s.partners);
  expect(diff.baselineNotInRoster).toEqual(['Unknown']);expect(diff.rows.find(r=>r.rowId==='r1')?.baselinePos).toBe(1);expect(diff.rows.find(r=>r.rowId==='r6')?.baselinePos).toBe(2);expect(diff.rows.find(r=>r.rowId==='r3')?.baselinePos).toBe(3);
  expect(kendallTau([])).toBeNull();expect(kendallTau([[1,2]])).toBeNull();expect(kendallTau([[1,1],[2,2],[3,3]])).toBe(1);expect(kendallTau([[1,3],[2,2],[3,1]])).toBe(-1);
  expect(diffBaseline({...output,openerRanking:['Neon Durian','Saltwater Static']},s.request,s.ranking,s.partners).kendallTau).toBeNull();
});
