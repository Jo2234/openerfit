import { z } from 'zod';
import type { ClaimSelection, WriterInfo } from '../shared/types';
import { claimSelectionSchema } from '../shared/schemas';
import { buildClaimCatalogue,selectCatalogueClaims,type CatalogueContext } from '../domain/template-writer';
import type { LlmAdapter,LlmResult } from './llm/adapter';
import { safeLlmCode } from './llm/adapter';
import { PROMPT_VERSION,WRITER_SYSTEM,writerUser,repairUser } from './prompts';
export interface WriterResult {selection:ClaimSelection|undefined;writer:WriterInfo}
/** Model output is only an ID selection; rejected raw prose never becomes a public claim/note. */
export async function selectBrief(ctx:CatalogueContext,adapter:LlmAdapter,signal:AbortSignal,scenarioId:string|null,maxTokens=1200):Promise<WriterResult> {
  signal.throwIfAborted();const {catalogue}=buildClaimCatalogue(ctx);
  const writer:WriterInfo={kind:'template',source:null,fixtureLabel:null,model:null,promptVersion:null,attempts:0,fallbackReason:null};
  if(adapter.mode==='none')return {selection:undefined,writer};
  writer.model=adapter.model;writer.promptVersion=PROMPT_VERSION;
  const schema=claimSelectionSchema(catalogue.map(c=>c.id)),user=writerUser(ctx.request,catalogue);
  let lastCompleted:LlmResult|null=null;
  for(const attempt of [0,1] as const){
    signal.throwIfAborted();writer.attempts++;
    try{
      const result=await adapter.complete({schemaName:'brief_claims',system:WRITER_SYSTEM,user:attempt?repairUser(user,'selection'):user,jsonSchema:z.toJSONSchema(schema),maxTokens,signal,fixtureKey:{scenarioId,step:0,attempt}});
      signal.throwIfAborted();lastCompleted=result;writer.model=result.model;writer.source=result.source;writer.fixtureLabel=result.fixtureLabel;
      let parsed:unknown;try{parsed=JSON.parse(result.text);}catch{parsed=null;}
      const checked=schema.safeParse(parsed);
      if(checked.success){selectCatalogueClaims(checked.data,catalogue);return {selection:checked.data,writer:{...writer,kind:'llm',fallbackReason:null}};}
      writer.fallbackReason='invalid_claim_selection';
    }catch(error){signal.throwIfAborted();writer.fallbackReason=safeLlmCode(error);break;}
  }
  // Actual completed invalid responses retain source; transport/refusal before any output does not.
  if(!lastCompleted){writer.source=null;writer.fixtureLabel=null;}
  return {selection:undefined,writer};
}
