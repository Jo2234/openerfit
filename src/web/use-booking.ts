import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { agentStepSchema, runSchema, runStateSchema } from '../shared/schemas';
import type { BriefRequest, ResolveResponse, RunOptions } from '../shared/types';
import { api as defaultApi, ApiError, errorCopy, type BookingApi, type Health, type Scenario } from './api';
import { confirmChoices, identityKey, initialChoices, persistDraft, restoreDraft, validateDraft, type Choices, type Draft, type FormErrors } from './form-model';
import { hasTerminalResult, isTerminal, reduceRun, type RunAction, type RunView } from './run-state';
export type Stage='setup'|'confirm'|'run';
interface Resolved {identity:string;data:ResolveResponse}
export interface Failure {message:string;code:string;retry:'resolve'|'start'|'restore'|'load'|'cancel'}
export function useBooking(client:BookingApi=defaultApi,makeEvents:(url:string)=>EventSource=url=>new EventSource(url)) {
  const [draft,setDraft]=useState<Draft>(()=>{try{return restoreDraft(window.localStorage);}catch{return restoreDraft(null);}});
  const draftRef=useRef(draft),scope=useRef(0),active=useRef<AbortController|null>(null),stream=useRef<EventSource|null>(null);
  const [stage,setStage]=useState<Stage>('setup'),[errors,setErrors]=useState<FormErrors>({}),[resolved,setResolved]=useState<Resolved|null>(null);
  const [choices,setChoices]=useState<Choices>({}),[view,setView]=useState<RunView|null>(null),viewRef=useRef<RunView|null>(null);
  const [pending,setPending]=useState<'resolve'|'start'|'cancel'|null>(null),[failure,setFailure]=useState<Failure|null>(null);
  const [health,setHealth]=useState<Health|null>(null),[scenarios,setScenarios]=useState<Scenario[]>([]),[booting,setBooting]=useState(true);
  const [storageAvailable,setStorageAvailable]=useState(true),[options,setOptions]=useState<RunOptions>({planner:'auto',baseline:true});
  const boot=useRef<AbortController|null>(null),pendingRef=useRef<typeof pending>(null);
  const markPending=(value:typeof pending)=>{pendingRef.current=value;setPending(value);};
  const closeStream=useCallback(()=>{stream.current?.close();stream.current=null;},[]);
  const retire=useCallback(()=>{scope.current++;active.current?.abort();active.current=null;closeStream();markPending(null);},[closeStream]);
  const update=(action:RunAction)=>{if(!viewRef.current)return;const next=reduceRun(viewRef.current,action);viewRef.current=next;setView(next);};
  const fail=(error:unknown,retry:Failure['retry'])=>setFailure({message:errorCopy(error),code:error instanceof ApiError?error.code:'network',retry});
  const load=useCallback(async()=>{
    boot.current?.abort();const controller=new AbortController();boot.current=controller;setBooting(true);
    const result=await Promise.allSettled([client.health(controller.signal),client.scenarios(controller.signal)]);
    if(controller.signal.aborted)return;
    if(result[0].status==='fulfilled')setHealth(result[0].value);else fail(result[0].reason,'load');
    if(result[1].status==='fulfilled')setScenarios(result[1].value);else fail(result[1].reason,'load');
    setBooting(false);
  },[client]);
  useEffect(()=>{void load();return()=>{boot.current?.abort();scope.current++;active.current?.abort();stream.current?.close();};},[load]);
  useEffect(()=>{try{setStorageAvailable(persistDraft(window.localStorage,draft));}catch{setStorageAvailable(false);}},[draft]);

  function edit(next:Draft) {
    const changedIdentity=identityKey(next)!==identityKey(draftRef.current);
    // Any form change retires a previous operation/run snapshot. Only identity
    // changes discard the server capability; fee/note edits can keep matches.
    retire();draftRef.current=next;setDraft(next);setView(null);viewRef.current=null;setFailure(null);setErrors({});
    if(changedIdentity){setResolved(null);setChoices({});}
  }
  function back(){retire();setFailure(null);setStage('setup');}
  function request():BriefRequest|null {const checked=validateDraft(draftRef.current);setErrors(checked.errors);return checked.request;}
  async function resolve(force=false) {
    if(pendingRef.current)return;
    const input=request();if(!input){setStage('setup');return;}
    const key=identityKey(input);
    if(!force&&resolved?.identity===key){setFailure(null);setStage('confirm');return;}
    retire();const serial=scope.current,controller=new AbortController();active.current=controller;
    draftRef.current=input;setDraft(input);setResolved(null);setChoices({});setFailure(null);markPending('resolve');
    try {
      const data=await client.resolve({headlinerQuery:input.headlinerQuery,roster:input.roster.map(({rowId,name})=>({rowId,name}))},controller.signal);
      if(serial!==scope.current||identityKey(draftRef.current)!==key)return;
      setResolved({identity:key,data});setChoices(initialChoices(data));setStage('confirm');
    }catch(error){if(!controller.signal.aborted&&serial===scope.current)fail(error,'resolve');}
    finally{if(serial===scope.current)markPending(null);}
  }
  async function restore(id:string,serial:number,signal:AbortSignal,keepInitialStream=false):Promise<boolean> {
    try {
      const run=await client.run(id,signal);
      if(serial!==scope.current||viewRef.current?.id!==id)return false;
      update({type:'snapshot',run});
      // The first GET may finish before a fast fixture stream opens. Keep that
      // original stream until it delivers its terminal payload (or disconnects).
      if(!keepInitialStream&&viewRef.current&&isTerminal(viewRef.current.state)&&!hasTerminalResult(viewRef.current)){
        closeStream();update({type:'connection',connection:'interrupted'});return false;
      }
      if(isTerminal(run.state)&&!keepInitialStream)closeStream();
      return true;
    }catch(error){
      if(serial!==scope.current||signal.aborted||viewRef.current?.id!==id||hasTerminalResult(viewRef.current))return false;
      closeStream();update({type:'connection',connection:'interrupted'});fail(error,'restore');return false;
    }
  }
  function connect(id:string,serial:number,signal:AbortSignal) {
    closeStream();const events=makeEvents(client.events(id));stream.current=events;
    const current=()=>serial===scope.current&&viewRef.current?.id===id&&stream.current===events&&!signal.aborted;
    const consume=(event:MessageEvent,fn:(value:unknown)=>void)=>{
      if(!current())return;try{fn(JSON.parse(event.data));}catch{closeStream();if(hasTerminalResult(viewRef.current))return;update({type:'connection',connection:'interrupted'});fail(new ApiError('invalid_response'),'restore');}
    };
    events.onopen=()=>{if(current())update({type:'connection',connection:'connected'});};
    events.addEventListener('state',event=>consume(event as MessageEvent,value=>update({type:'state',state:runStateSchema.parse(z.object({state:runStateSchema}).parse(value).state)})));
    events.addEventListener('step',event=>consume(event as MessageEvent,value=>update({type:'step',step:agentStepSchema.parse(value)})));
    events.addEventListener('done',event=>consume(event as MessageEvent,value=>{update({type:'snapshot',run:runSchema.parse(value)});closeStream();}));
    // Close on transport error to stop EventSource's autonomous reconnect loop.
    // Recovery is a deliberate GET + reconnect action, never a polling timer.
    events.onerror=event=>{
      if(!current())return;
      if('data' in event&&typeof event.data==='string')consume(event as MessageEvent,value=>{const error=z.object({code:z.string(),message:z.string()}).parse(value);update({type:'failed',error});closeStream();void restore(id,serial,signal);});
      else {closeStream();update({type:'connection',connection:'interrupted'});}
    };
  }
  async function start() {
    if(pendingRef.current)return;
    const input=request();if(!input){setStage('setup');return;}
    if(!resolved||resolved.identity!==identityKey(input)){setResolved(null);setStage('setup');fail(new ApiError('invalid_request'),'resolve');return;}
    const selection=confirmChoices(resolved.data,choices);if(!selection.confirmed)return;
    retire();const serial=scope.current,controller=new AbortController();active.current=controller;markPending('start');setFailure(null);
    try {
      const {runId}=await client.start({resolveId:resolved.data.resolveId,request:input,resolutions:selection.confirmed,options},controller.signal);
      if(serial!==scope.current)return;
      const initial:RunView={id:runId,state:'queued',steps:[],result:null,connection:'connecting',error:null};viewRef.current=initial;setView(initial);setStage('run');
      connect(runId,serial,controller.signal);void restore(runId,serial,controller.signal,true);
    }catch(error){if(!controller.signal.aborted&&serial===scope.current)fail(error,'start');}
    finally{if(serial===scope.current)markPending(null);}
  }
  async function cancel() {
    if(pendingRef.current)return;
    const current=viewRef.current;if(!current||isTerminal(current.state))return;
    const serial=scope.current,controller=active.current??new AbortController();active.current=controller;markPending('cancel');setFailure(null);
    try {
      await client.cancel(current.id,controller.signal);if(serial!==scope.current)return;
      update({type:'cancelled'});closeStream();await restore(current.id,serial,controller.signal);
    }catch(error){if(serial===scope.current&&!controller.signal.aborted){fail(error,'cancel');if(error instanceof ApiError&&error.code==='run_finished')await restore(current.id,serial,controller.signal);}}
    finally{if(serial===scope.current)markPending(null);}
  }
  async function reconnect() {
    const current=viewRef.current;if(!current||current.connection==='recovering'||hasTerminalResult(current))return;
    const serial=scope.current,controller=active.current??new AbortController();active.current=controller;setFailure(null);
    update({type:'connection',connection:'recovering'});
    const restored=await restore(current.id,serial,controller.signal);
    if(restored&&serial===scope.current&&viewRef.current&&!isTerminal(viewRef.current.state))connect(current.id,serial,controller.signal);
  }
  function retry(){if(failure?.retry==='load'){setFailure(null);void load();}else if(failure?.retry==='restore')void reconnect();else if(failure?.retry==='cancel')void cancel();else if(failure?.code==='invalid_request'||failure?.code==='run_not_found'||failure?.retry==='resolve')void resolve(true);else void start();}
  return {draft,edit,stage,back,errors,resolved:resolved?.data??null,choices,setChoices,view,pending,failure,health,scenarios,booting,storageAvailable,options,setOptions,resolve,start,cancel,reconnect,retry};
}
