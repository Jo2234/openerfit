// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Setup } from '../../src/web/components/setup';
import { Ranking, Comparison } from '../../src/web/components/results';
import { BaselineProvenance, ModeBar, WriterProvenance } from '../../src/web/components/provenance';
import { confirmChoices, initialChoices, restoreDraft, persistDraft, STORAGE_KEY, type Draft } from '../../src/web/form-model';
import { COPY } from '../../src/shared/copy';
import { brief, input, resolution } from './fixtures';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('W1: accepted parser applies CSV/TSV/name lines atomically; malformed fees preserve the existing roster',()=>{
  function Harness(){const [draft,setDraft]=useState<Draft>(input());return <Setup draft={draft} edit={setDraft} errors={{}} scenarios={[]} booting={false} fixture pending={false} storageAvailable options={{planner:'auto',baseline:true}} setOptions={()=>{}} onSubmit={()=>{}} hasMatches={false}/>;}
  render(<Harness/>);fireEvent.click(screen.getByText('Paste a roster',{exact:true}));const paste=screen.getByLabelText('CSV, TSV or one act per line');
  for(const text of ['name,fee,bookability,notes\nFiction Act,0,unknown,Note','name\tfee\tbookability\tnotes\nFiction Act\t0\tunknown\tNote','Fiction Act']){
    fireEvent.change(paste,{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'Replace roster from paste'}));expect((screen.getByLabelText('Act 1 name') as HTMLInputElement).value).toBe('Fiction Act');
  }
  fireEvent.change(paste,{target:{value:'name,fee\nBroken Act,not-a-number'}});fireEvent.click(screen.getByRole('button',{name:'Replace roster from paste'}));expect(screen.getByRole('alert').textContent).toContain('Fees must');expect((screen.getByLabelText('Act 1 name') as HTMLInputElement).value).toBe('Fiction Act');
});
it('W3/W6: missing affinity is literal text, actual zero remains 0.000, no affinity percent; fees/bookability stay separate',()=>{
  render(<Ranking brief={brief()} onReceipt={()=>{}}/>);const region=screen.getByRole('region',{name:'Opener affinity ranking'});
  const missing=within(region).getByRole('row',{name:/Unscored Act/});expect(within(missing).getByText(COPY.noAffinity).textContent).toBe(COPY.noAffinity);expect(within(missing).queryByText('0.000')).toBeNull();
  const zero=within(region).getByRole('row',{name:/Zero Act/});expect(within(zero).getByText('0.000')).toBeTruthy();expect(within(zero).getByText('0 SGD')).toBeTruthy();expect(within(zero).getByText('unknown')).toBeTruthy();expect(region.textContent).not.toContain('%');
});
it('W5: configured or actual fixture origins show the prominent policy banner independently',()=>{
  const {rerender}=render(<ModeBar health={{ok:true,qloo:{mode:'fixture',keyPresent:false,baseUrl:'hackathon.api.qloo.com'},llm:{mode:'none',model:null,reachable:null}}} brief={null}/>);expect(screen.getByText(COPY.fixtureBanner)).toBeTruthy();
  rerender(<ModeBar health={{ok:true,qloo:{mode:'live',keyPresent:true,baseUrl:'hackathon.api.qloo.com'},llm:{mode:'none',model:null,reachable:null}}} brief={brief()}/>);expect(screen.getByText(COPY.fixtureBanner)).toBeTruthy();
});
it('writer/baseline provenance uses actual completed source; failed transport template is not model output',()=>{
  const value=brief().writer;const {rerender}=render(<WriterProvenance writer={value}/>);expect(screen.getByText(/Selection source: hand-written fixture/)).toBeTruthy();
  rerender(<WriterProvenance writer={{...value,kind:'template',source:null,fixtureLabel:null,model:'attempted-provider',fallbackReason:'llm_timeout'}}/>);expect(screen.getByText('Selection source: no completed model output.')).toBeTruthy();expect(screen.getByText(/Attempted model:/)).toBeTruthy();expect(screen.queryByText('Selection source: completed model output.')).toBeNull();
  rerender(<BaselineProvenance baseline={{status:'ok',source:'fixture',model:'hand-written fixture',fixtureLabel:'Fictional baseline',promptVersion:'ofv1.1',output:{openerRanking:[],partners:{brand:[],place:[],podcast:[]},rationale:[]},error:null,latencyMs:0}}/>);expect(screen.getByText(COPY.baselineFixture)).toBeTruthy();
});
it('confirmation rejects duplicate entity/headliner inclusion even among known candidates',()=>{
  const resolved=resolution();resolved.roster[1].candidates.push(resolved.headliner.chosen!);const choices=initialChoices(resolved);choices.r2=resolved.headliner.chosen!.entityId;choices.r7=resolved.roster[2].candidates[0].entityId;expect(confirmChoices(resolved,choices).confirmed).toBeNull();
});
it('typed persistence ignores corrupt/incompatible/extra capability data and tolerates inaccessible storage',()=>{
  for(const value of ['broken','{}',JSON.stringify({version:2,form:input()}),JSON.stringify({version:1,form:input(),resolveId:'secret-capability'})])expect(restoreDraft({getItem:()=>value}).headlinerQuery).toBe('');
  let stored='';expect(persistDraft({setItem:(_key,value)=>{stored=value;}},input())).toBe(true);expect(restoreDraft({getItem:key=>key===STORAGE_KEY?stored:null})).toEqual(input());expect(stored).not.toContain('resolveId');expect(persistDraft({setItem:()=>{throw new Error('blocked');}},input())).toBe(false);
});
it('comparison labels fixture differences and null tau without raw model text access',()=>{
  render(<Comparison baseline={{status:'ok',source:'fixture',model:'fixture',fixtureLabel:null,promptVersion:null,output:{openerRanking:[],partners:{brand:[],place:[],podcast:[]},rationale:[]},error:null,latencyMs:0}} diff={{rows:[],kendallTau:null,changedPositions:0,baselineNotInRoster:[],partners:{brand:{matchedQloo:[],noReceipt:[]},place:{matchedQloo:[],noReceipt:[]},podcast:{matchedQloo:[],noReceipt:[]}},baselineCopyViolations:[]}} fixture/>);fireEvent.click(screen.getByRole('switch'));expect(screen.getByRole('heading',{name:'Ranking comparison'})).toBeTruthy();expect(screen.getByText(/Insufficient shared rankings/)).toBeTruthy();expect(screen.queryByText(/raw model/i)).toBeNull();
});
