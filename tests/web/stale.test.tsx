// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useBooking } from '../../src/web/use-booking';
import { identityKey, initialChoices } from '../../src/web/form-model';
import { api, type BookingApi } from '../../src/web/api';
import { input, resolution, run } from './fixtures';
afterEach(()=>{cleanup();window.localStorage.clear();vi.restoreAllMocks();});
it('stale resolution cannot replace a newer identity; constraints do not change the identity key',async()=>{
  let resolve!:(value:ReturnType<typeof resolution>)=>void;
  const pending=new Promise<ReturnType<typeof resolution>>(r=>{resolve=r;});
  const client:BookingApi={...api,health:vi.fn().mockResolvedValue({ok:true,qloo:{mode:'fixture',keyPresent:false,baseUrl:'hackathon.api.qloo.com'},llm:{mode:'none',model:null,reachable:null}}),scenarios:vi.fn().mockResolvedValue([]),resolve:vi.fn().mockReturnValue(pending)};
  const {result}=renderHook(()=>useBooking(client));await waitFor(()=>expect(result.current.booting).toBe(false));
  act(()=>result.current.edit(input()));let operation!:Promise<void>;act(()=>{operation=result.current.resolve();});
  act(()=>result.current.edit({...input(),headlinerQuery:'New identity'}));await act(async()=>{resolve(resolution());await operation;});expect(result.current.resolved).toBeNull();expect(result.current.draft.headlinerQuery).toBe('New identity');expect(result.current.stage).toBe('setup');
  const modified=input();modified.roster[0].feeAmount=0;modified.roster[0].bookability='unknown';expect(identityKey(modified)).toBe(identityKey(input()));expect(initialChoices(resolution()).r2).toBe('');
});
it('cancelled run ignores a stale completed snapshot and closes its owned EventSource',async()=>{
  const resolved=resolution(),draft=input();draft.roster=draft.roster.filter(r=>resolved.roster.some(match=>match.target===r.rowId));
  const finished=run();const writing={...finished,state:'writing' as const,brief:null,finishedAt:null};
  const source=new EventTarget() as EventTarget & {onopen:((event:Event)=>void)|null;onerror:((event:Event)=>void)|null;close:ReturnType<typeof vi.fn>};source.onopen=null;source.onerror=null;source.close=vi.fn();
  const client:BookingApi={...api,health:vi.fn().mockResolvedValue({ok:true,qloo:{mode:'fixture',keyPresent:false,baseUrl:'hackathon.api.qloo.com'},llm:{mode:'none',model:null,reachable:null}}),scenarios:vi.fn().mockResolvedValue([]),resolve:vi.fn().mockResolvedValue(resolved),start:vi.fn().mockResolvedValue({runId:finished.id}),run:vi.fn().mockResolvedValueOnce(writing).mockResolvedValueOnce(finished),cancel:vi.fn().mockResolvedValue({state:'cancelled'})};
  const events=vi.fn(()=>source as unknown as EventSource);
  const {result}=renderHook(()=>useBooking(client,events));await waitFor(()=>expect(result.current.booting).toBe(false));act(()=>result.current.edit(draft));await act(async()=>{await result.current.resolve();});
  act(()=>result.current.setChoices({...initialChoices(resolved),r2:'fx-moth-a',r7:'fx-velvet'}));await act(async()=>{await result.current.start();});await waitFor(()=>expect(result.current.view?.state).toBe('writing'));
  await act(async()=>{await result.current.cancel();});expect(result.current.view?.state).toBe('cancelled');expect(source.close).toHaveBeenCalled();expect(client.cancel).toHaveBeenCalledOnce();
  act(()=>source.dispatchEvent(new MessageEvent('done',{data:JSON.stringify(finished)})));expect(result.current.view?.state).toBe('cancelled');expect(result.current.view?.result?.brief).toBeNull();expect(events).toHaveBeenCalledOnce();
});
