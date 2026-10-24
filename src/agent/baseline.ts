import { z } from 'zod';
import type { BaselineResult, BriefRequest } from '../shared/types';
import { baselineOutputSchema } from '../shared/schemas';
import type { LlmAdapter } from './llm/adapter';
import { safeLlmCode } from './llm/adapter';
import { BASELINE_SYSTEM,PROMPT_VERSION,baselineUser,repairUser } from './prompts';
export async function runBaseline(request:BriefRequest,adapter:LlmAdapter,signal:AbortSignal,scenarioId:string|null,maxTokens=900):Promise<BaselineResult> {
  signal.throwIfAborted();const result:BaselineResult={status:'unavailable',source:null,model:null,fixtureLabel:null,promptVersion:null,output:null,error:null,latencyMs:null};
  if(adapter.mode==='none')return result;
  result.model=adapter.model;result.promptVersion=PROMPT_VERSION;let latency=0;
  const user=baselineUser(request);
  for(const attempt of [0,1] as const){
    signal.throwIfAborted();
    try{
      const response=await adapter.complete({schemaName:'baseline',system:BASELINE_SYSTEM,user:attempt?repairUser(user,'baseline'):user,jsonSchema:z.toJSONSchema(baselineOutputSchema),maxTokens,signal,fixtureKey:{scenarioId,step:0,attempt}});
      signal.throwIfAborted();latency+=response.latencyMs;result.source=response.source;result.model=response.model;result.fixtureLabel=response.fixtureLabel;result.latencyMs=latency;
      let parsed:unknown;try{parsed=JSON.parse(response.text);}catch{parsed=null;}
      const checked=baselineOutputSchema.safeParse(parsed);if(checked.success)return {...result,status:'ok',output:checked.data,error:null};
      result.status='invalid_output';result.error={code:'baseline_invalid_output',message:'The baseline output did not match the schema.'};
    }catch(error){signal.throwIfAborted();return {...result,status:'error',error:{code:safeLlmCode(error),message:'The baseline could not be completed.'}};}
  }
  return result;
}
