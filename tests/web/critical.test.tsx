// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Confirm } from '../../src/web/components/confirm';
import { ReceiptChip, ReceiptDrawer } from '../../src/web/components/receipt';
import { api } from '../../src/web/api';
import { initialChoices } from '../../src/web/form-model';
import { reduceRun, type RunView } from '../../src/web/run-state';
import { receipt, resolution, run } from './fixtures';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('W2: blocks Build brief until ambiguous and inexact choices are explicitly confirmed',()=>{
  const resolved=resolution();const start=vi.fn();
  function Harness(){const [choices,setChoices]=useState(initialChoices(resolved));return <Confirm resolved={resolved} choices={choices} onChange={setChoices} onBack={()=>{}} onStart={start} pending={false}/>;}
  render(<Harness/>);const build=screen.getByRole('button',{name:/Build brief/}) as HTMLButtonElement;
  expect(build.disabled).toBe(true);
  fireEvent.click(within(screen.getByRole('group',{name:/Moth Parade/})).getByRole('radio',{name:/2019, Singapore indie/}));expect(build.disabled).toBe(true);
  fireEvent.click(within(screen.getByRole('group',{name:/Velvet Monsoon/})).getByRole('radio',{name:/Velvet Monsoon Trio/}));expect(build.disabled).toBe(false);
  fireEvent.click(build);expect(start).toHaveBeenCalledOnce();
});
it('W4: actual receipt drawer shows exact fields/null excerpt, traps focus, closes on Escape and restores trigger',async()=>{
  vi.spyOn(api,'receipt').mockResolvedValue({receipt,entityExcerpt:null});
  function Harness(){const [open,setOpen]=useState(false);return <><ReceiptChip id={receipt.id} receipt={receipt} ready onOpen={()=>setOpen(true)}/>{open&&<ReceiptDrawer runId={run().id} id={receipt.id} onClose={()=>setOpen(false)}/>}</>;}
  render(<Harness/>);const trigger=screen.getByRole('button',{name:/Receipt R-zero/});trigger.focus();fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog');await waitFor(()=>expect(within(dialog).getByTestId('raw-receipt-value').textContent).toBe('0'));
  for(const text of [receipt.endpoint,receipt.valuePath,receipt.callId,'filter.type','urn:entity:artist','7'])expect(within(dialog).getByText(text,{exact:true})).toBeTruthy();
  expect(within(dialog).getByText(/No raw entity excerpt/)).toBeTruthy();
  const close=within(dialog).getByRole('button',{name:'Close receipt'});expect(document.activeElement).toBe(close);fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(close);
  fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('terminal cancellation rejects a stale done snapshot and replayed step indexes are deduplicated',()=>{
  const finished=run();const initial:RunView={id:finished.id,state:'writing',steps:[],result:null,connection:'connected',error:null};
  const step={index:0,planner:'system' as const,kind:'note' as const,tool:null,args:null,status:'ok' as const,summary:'Synthetic note',callIds:[],receiptIds:[],durationMs:0,error:null};
  const once=reduceRun(reduceRun(initial,{type:'step',step}),{type:'step',step});expect(once.steps).toHaveLength(1);
  const cancelled=reduceRun(once,{type:'cancelled'});expect(reduceRun(cancelled,{type:'snapshot',run:finished})).toEqual(cancelled);
  expect(reduceRun(cancelled,{type:'state',state:'done'}).state).toBe('cancelled');
});
