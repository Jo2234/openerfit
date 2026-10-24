// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Run, RunState } from '../../src/shared/types';
import { ApiError, api, type BookingApi } from '../../src/web/api';
import { Activity } from '../../src/web/components/activity';
import { confirmChoices, initialChoices } from '../../src/web/form-model';
import { hasTerminalResult, needsTerminalRecovery, reduceRun } from '../../src/web/run-state';
import { useBooking } from '../../src/web/use-booking';
import { input, resolution, run } from './fixtures';
afterEach(()=>{cleanup();window.localStorage.clear();vi.restoreAllMocks();});

// Injected lifecycle-only boundaries. No service harness, HTTP, browser or model.
async function prepare(state:'done'|'failed'|'cancelled',initial:'active'|'terminal'|'pending'='active') {
  const resolved=resolution(),draft=input();draft.roster=draft.roster.filter(row=>resolved.roster.some(match=>match.target===row.rowId));
  const choices={...initialChoices(resolved),r2:'fx-moth-a',r7:'fx-velvet'};
  const completed:Run={...run(),state,request:draft,resolutions:confirmChoices(resolved,choices).confirmed!,error:state==='failed'?{code:'qloo_unavailable',message:'Synthetic failure'}:null};
  if(state!=='done')completed.brief=null;
  const active:Run={...completed,state:'writing',brief:null,error:null,finishedAt:null};
  const source=new EventTarget() as EventTarget&{onopen:((event:Event)=>void)|null;onerror:((event:Event)=>void)|null;close:ReturnType<typeof vi.fn>};
  source.onopen=null;source.onerror=null;source.close=vi.fn();
  let rejectInitial!:(error:unknown)=>void;
  const pending=new Promise<Run>((_resolve,reject)=>{rejectInitial=reject;});
  const get=vi.fn<BookingApi['run']>().mockResolvedValue(completed);
  if(initial==='pending')get.mockImplementationOnce(()=>pending);
  else get.mockResolvedValueOnce(initial==='terminal'?completed:active);
  const client:BookingApi={...api,health:vi.fn().mockResolvedValue({ok:true,qloo:{mode:'fixture',keyPresent:false,baseUrl:'hackathon.api.qloo.com'},llm:{mode:'none',model:null,reachable:null}}),scenarios:vi.fn().mockResolvedValue([]),resolve:vi.fn().mockResolvedValue(resolved),start:vi.fn().mockResolvedValue({runId:completed.id}),run:get};
  const events=vi.fn(()=>source as unknown as EventSource);
  const hook=renderHook(()=>useBooking(client,events));await waitFor(()=>expect(hook.result.current.booting).toBe(false));
  act(()=>hook.result.current.edit(draft));await act(async()=>{await hook.result.current.resolve();});
  act(()=>hook.result.current.setChoices(choices));await act(async()=>{await hook.result.current.start();});
  if(initial!=='pending')await waitFor(()=>expect(hook.result.current.view?.result?.state).toBe(initial==='terminal'?state:'writing'));
  return {...hook,client,events,source,completed,rejectInitial};
}
it.each(['done','failed','cancelled'] as const)('%s announcement + transport drop offers one explicit GET, preserves terminal state and never reopens its stream',async state=>{
  const {result,client,events,source,completed}=await prepare(state);
  act(()=>source.dispatchEvent(new MessageEvent('state',{data:JSON.stringify({state})})));
  expect(result.current.view?.state).toBe(state);expect(needsTerminalRecovery(result.current.view!)).toBe(true);
  act(()=>source.onerror?.(new Event('error')));
  expect(result.current.view?.connection).toBe('interrupted');expect(client.run).toHaveBeenCalledTimes(1);expect(result.current.failure).toBeNull();expect(source.close).toHaveBeenCalledOnce();
  const activity=(view:NonNullable<typeof result.current.view>)=><Activity view={view} pending={false} onCancel={()=>{}} onReconnect={()=>void result.current.reconnect()} onReceipt={()=>{}}/>;
  const panel=render(activity(result.current.view!));expect(screen.getByRole('heading',{name:/pending/})).toBeTruthy();expect(screen.queryByRole('heading',{name:'Brief complete'})).toBeNull();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Recover final result'}));});
  await waitFor(()=>expect(hasTerminalResult(result.current.view)).toBe(true));
  expect(result.current.view?.state).toBe(state);expect(result.current.view?.result).toEqual(completed);expect(result.current.view?.connection).toBe('closed');
  expect(client.run).toHaveBeenCalledTimes(2);expect(client.start).toHaveBeenCalledOnce();expect(events).toHaveBeenCalledOnce();
  panel.rerender(activity(result.current.view!));expect(screen.queryByRole('button',{name:'Recover final result'})).toBeNull();
  if(state==='done')expect(screen.getByRole('heading',{name:'Brief complete'})).toBeTruthy();
  const before=result.current.view!;
  expect(reduceRun(before,{type:'state',state:'ranking'})).toEqual(before);
  const other:RunState=state==='cancelled'?'done':'cancelled';
  expect(reduceRun(before,{type:'snapshot',run:{...completed,state:other}})).toEqual(before);
  // Even an already queued callback from the closed stream cannot mutate it.
  act(()=>source.dispatchEvent(new MessageEvent('done',{data:JSON.stringify({...completed,state:other})})));
  expect(result.current.view?.state).toBe(state);expect(client.start).toHaveBeenCalledOnce();expect(events).toHaveBeenCalledOnce();
});
it('late initial GET failure cannot add an error banner or reopen a complete terminal result',async()=>{
  const {result,client,events,source,completed,rejectInitial}=await prepare('done','pending');
  act(()=>source.dispatchEvent(new MessageEvent('done',{data:JSON.stringify(completed)})));
  expect(hasTerminalResult(result.current.view)).toBe(true);
  await act(async()=>{rejectInitial(new ApiError('network'));await Promise.resolve();});
  expect(result.current.view?.result).toEqual(completed);expect(result.current.failure).toBeNull();expect(result.current.view?.connection).toBe('closed');
  expect(client.run).toHaveBeenCalledOnce();expect(client.start).toHaveBeenCalledOnce();expect(events).toHaveBeenCalledOnce();expect(source.close).toHaveBeenCalledOnce();
});
it('a fast terminal initial GET keeps its original stream until a real terminal message, without opening another stream',async()=>{
  const {result,client,events,source,completed}=await prepare('done','terminal');
  expect(hasTerminalResult(result.current.view)).toBe(true);expect(source.close).not.toHaveBeenCalled();
  act(()=>source.dispatchEvent(new MessageEvent('done',{data:JSON.stringify(completed)})));
  expect(source.close).toHaveBeenCalledOnce();expect(events).toHaveBeenCalledOnce();expect(client.run).toHaveBeenCalledOnce();expect(client.start).toHaveBeenCalledOnce();
});
