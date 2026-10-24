import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LlmError,type LlmAdapter,type LlmRequest,type LlmResult } from './adapter';
export const LLM_FIXTURE_LABEL='Hand-written fixture to demonstrate the agent and comparison, not a model output.';
/** Exact named fixtures only; step/repair is supplied by the run, never a shared counter. */
export class FixtureLlmAdapter implements LlmAdapter {
  readonly mode='fixture' as const;readonly model='hand-written fixture';
  constructor(private root=path.resolve('fixtures/llm')){}
  async health(){return null;}
  async complete(request:LlmRequest):Promise<LlmResult> {
    request.signal.throwIfAborted();const {scenarioId,step,attempt=0}=request.fixtureKey;
    if(scenarioId!=='fx-sg-indie'||!Number.isInteger(step)||step<0||step>5||![0,1].includes(attempt))throw new LlmError('llm_fixture_missing');
    const suffix=request.schemaName==='planner_action'?`.step${step}`:'';
    const filename=`${request.schemaName}.ofv1.1${suffix}${attempt?'.repair1':''}.json`;
    let fixture:any;try{const raw=await readFile(path.join(this.root,scenarioId,filename),{encoding:'utf8',signal:request.signal});request.signal.throwIfAborted();if(raw.length>65536)throw new Error();fixture=JSON.parse(raw);}catch{request.signal.throwIfAborted();throw new LlmError('llm_fixture_missing');}
    if(fixture.synthetic!==true||fixture.provenance!=='hand-written fixture'||typeof fixture.text!=='string')throw new LlmError('llm_fixture_invalid');
    return {text:fixture.text,latencyMs:0,model:this.model,source:'fixture',fixtureLabel:LLM_FIXTURE_LABEL,usage:{promptTokens:null,completionTokens:null}};
  }
}
