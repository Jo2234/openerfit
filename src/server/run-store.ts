import { randomBytes } from 'node:crypto';
import type { AgentStep, Brief, BaselineResult, BaselineDiff, Run, RunState } from '../shared/types';
export type RunEvent = {event:'state';data:{state:RunState}} | {event:'step';data:AgentStep} | {event:'done';data:Run} | {event:'error';data:{code:string;message:string}};
const terminal = (s:RunState) => ['done','failed','cancelled'].includes(s);
export const newRunId = () => 'run_'+randomBytes(16).toString('hex');
const allowed:Record<RunState,RunState[]>={queued:['ranking'],ranking:['partners'],partners:['writing'],writing:['baseline','done'],baseline:['done'],done:[],failed:[],cancelled:[]};
interface Entry {run:Run;controller:AbortController;touched:number;listeners:Set<(event:RunEvent)=>void>}
export class RunStore {
  private entries=new Map<string,Entry>();
  constructor(private max=50,private ttlMs=2*3600000,private now=Date.now){}
  private purge(){for(const [id,e]of this.entries)if(this.now()-e.touched>=this.ttlMs)this.remove(id);}
  private remove(id:string){const e=this.entries.get(id);if(!e)return;if(!terminal(e.run.state))this.cancel(id);e.listeners.clear();this.entries.delete(id);}
  add(run:Run):AbortSignal {this.purge();if(this.entries.has(run.id))throw new Error('Duplicate run ID');while(this.entries.size>=this.max)this.remove(this.entries.keys().next().value!);const e:Entry={run:structuredClone(run),controller:new AbortController(),touched:this.now(),listeners:new Set()};this.entries.set(run.id,e);return e.controller.signal;}
  get(id:string):Run|null {this.purge();const e=this.entries.get(id);if(!e)return null;this.entries.delete(id);this.entries.set(id,e);return structuredClone(e.run);}
  private emit(e:Entry,event:RunEvent){for(const listener of e.listeners){try{listener(structuredClone(event));}catch{e.listeners.delete(listener);}}}
  transition(id:string,state:RunState):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;if(!allowed[e.run.state].includes(state)||state==='done')throw new Error('Invalid run transition');e.run.state=state;this.emit(e,{event:'state',data:{state}});return true;}
  step(id:string,step:AgentStep):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;e.run.steps.push(structuredClone(step));this.emit(e,{event:'step',data:step});return true;}
  countCall(id:string):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;if(e.run.qlooCallCount>=14)throw new Error('Run Qloo call budget exhausted');e.run.qlooCallCount++;return true;}
  complete(id:string,result:{brief:Brief;baseline:BaselineResult|null;diff:BaselineDiff|null}):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;if(!result.brief || !allowed[e.run.state].includes('done'))throw new Error('Run cannot complete before writing');Object.assign(e.run,structuredClone(result),{state:'done',finishedAt:new Date(this.now()).toISOString()});this.emit(e,{event:'state',data:{state:'done'}});this.emit(e,{event:'done',data:e.run});e.listeners.clear();return true;}
  fail(id:string,error:{code:string;message:string}):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;Object.assign(e.run,{state:'failed',error,finishedAt:new Date(this.now()).toISOString()});e.controller.abort(new Error('Run failed'));this.emit(e,{event:'state',data:{state:'failed'}});this.emit(e,{event:'error',data:error});e.listeners.clear();return true;}
  cancel(id:string):boolean {const e=this.entries.get(id);if(!e||terminal(e.run.state))return false;Object.assign(e.run,{state:'cancelled',finishedAt:new Date(this.now()).toISOString()});e.controller.abort(new Error('Run cancelled'));this.emit(e,{event:'state',data:{state:'cancelled'}});this.emit(e,{event:'done',data:e.run});e.listeners.clear();return true;}
  subscribe(id:string,listener:(event:RunEvent)=>void):(()=>void)|null {this.purge();const e=this.entries.get(id);if(!e)return null;listener({event:'state',data:{state:e.run.state}});for(const data of e.run.steps)listener({event:'step',data:structuredClone(data)});if(e.run.state==='failed')listener({event:'error',data:e.run.error!});else if(terminal(e.run.state))listener({event:'done',data:structuredClone(e.run)});else e.listeners.add(listener);return ()=>e.listeners.delete(listener);}
  close(){for(const id of this.entries.keys())this.remove(id);}
}
