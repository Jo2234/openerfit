import type { AppEnv } from '../../server/env';
import type { LlmMode } from '../../shared/types';
import { FixtureLlmAdapter } from './fixture';
import { OpenAICompatibleAdapter } from './openai-compatible';
export interface LlmRequest {
  schemaName:'planner_action'|'brief_claims'|'baseline'; system:string; user:string;
  jsonSchema:object; maxTokens:number; signal:AbortSignal;
  fixtureKey:{scenarioId:string|null;step:number;attempt?:0|1};
}
export interface LlmResult {
  text:string;latencyMs:number;model:string;source:'llm'|'fixture';fixtureLabel:string|null;
  usage:{promptTokens:number|null;completionTokens:number|null};
}
export interface LlmAdapter {
  mode:LlmMode;model:string|null;
  complete(request:LlmRequest):Promise<LlmResult>;
  health():Promise<boolean|null>;
}
export class LlmError extends Error {
  constructor(public code:string,message='The language-model request could not be completed.') {super(message);this.name='LlmError';}
}
export class NoneLlmAdapter implements LlmAdapter {
  readonly mode='none' as const;readonly model=null;
  async complete(request:LlmRequest):Promise<LlmResult>{request.signal.throwIfAborted();throw new LlmError('llm_unavailable');}
  async health(){return null;}
}
/** Stateless adapters may be shared; all sequence/repair keys belong to the individual run. */
export function createLlmAdapter(env:AppEnv['llm']):LlmAdapter {
  return env.mode==='none'?new NoneLlmAdapter():env.mode==='fixture'?new FixtureLlmAdapter():new OpenAICompatibleAdapter(env);
}
export function safeLlmCode(error:unknown):string {return error instanceof LlmError?error.code:'llm_error';}
