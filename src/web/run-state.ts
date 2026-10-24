import type { AgentStep, Run, RunState } from '../shared/types';
export const isTerminal=(state:RunState)=>['done','failed','cancelled'].includes(state);
export interface RunView {id:string;state:RunState;steps:AgentStep[];result:Run|null;connection:'connecting'|'connected'|'interrupted'|'recovering'|'closed';error:{code:string;message:string}|null}
/** A terminal announcement is immutable, but is not itself the final Run data. */
export function hasTerminalResult(view:RunView|null):boolean {
  if(!view||!isTerminal(view.state)||view.result?.id!==view.id||view.result.state!==view.state)return false;
  return view.state==='done'?view.result.brief!==null:view.state==='failed'?view.result.error!==null:true;
}
export const needsTerminalRecovery=(view:RunView)=>isTerminal(view.state)&&!hasTerminalResult(view);
export type RunAction = {type:'snapshot';run:Run}|{type:'state';state:RunState}|{type:'step';step:AgentStep}|{type:'connection';connection:RunView['connection']}|{type:'cancelled'}|{type:'failed';error:{code:string;message:string}};
const order:RunState[]=['queued','ranking','partners','writing','baseline','done'];
export function mergeSteps(old:AgentStep[],fresh:AgentStep[]):AgentStep[]{return [...new Map([...old,...fresh].map(s=>[s.index,s])).values()].sort((a,b)=>a.index-b.index);}
export function reduceRun(view:RunView,action:RunAction):RunView {
  if(action.type==='snapshot'){
    if(action.run.id!==view.id || isTerminal(view.state)&&action.run.state!==view.state)return view;
    const state=!isTerminal(action.run.state)&&order.indexOf(action.run.state)<order.indexOf(view.state)?view.state:action.run.state;
    return {...view,state,steps:mergeSteps(view.steps,action.run.steps),result:action.run,error:action.run.error,connection:hasTerminalResult({...view,state,result:action.run})?'closed':view.connection};
  }
  if(isTerminal(view.state)){
    if(action.type==='connection'&&!hasTerminalResult(view))return {...view,connection:action.connection};
    return action.type==='failed'&&view.state==='failed'&&!hasTerminalResult(view)?{...view,error:action.error}:view;
  }
  if(action.type==='cancelled')return {...view,state:'cancelled',connection:'closed'};
  if(action.type==='failed')return {...view,state:'failed',error:action.error,connection:'closed'};
  if(action.type==='state')return order.indexOf(action.state)>=0&&order.indexOf(action.state)<order.indexOf(view.state)?view:{...view,state:action.state};
  if(action.type==='step')return {...view,steps:mergeSteps(view.steps,[action.step])};
  return {...view,connection:action.connection};
}
