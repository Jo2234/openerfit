import { z } from 'zod';
import type { LlmAdapter } from './llm/adapter';
import { safeLlmCode } from './llm/adapter';
import { plannerActionSchema } from './protocol';
import { PLANNER_SYSTEM,plannerUser,repairUser } from './prompts';
import { scriptedCoverage } from './planner-scripted';
import type { ToolSession } from './tools';
/** At most six decision turns, one schema repair per invalid decision, then coverage. */
export async function planPartners(session:ToolSession,adapter:LlmAdapter,scenarioId:string|null,maxTokens=300):Promise<void> {
  const {signal,run}=session.context;
  if(adapter.mode!=='none'&&run.options.planner!=='scripted'){
    for(let turn=0;turn<6;turn++){
      signal.throwIfAborted();const schema=plannerActionSchema(run.request.partnerCategories,[...session.tags.keys()]);
      const user=plannerUser(run.request,session.ranking!,session.steps,[...session.tags.values()],turn,session.categoryProgress());
      let action:z.infer<typeof schema>|null=null;let adapterFailed=false;
      for(const attempt of [0,1] as const){
        signal.throwIfAborted();
        try{
          const result=await adapter.complete({schemaName:'planner_action',system:PLANNER_SYSTEM,user:attempt?repairUser(user,'planner'):user,jsonSchema:z.toJSONSchema(schema),maxTokens,signal,fixtureKey:{scenarioId,step:turn,attempt}});
          signal.throwIfAborted();let parsed:unknown;try{parsed=JSON.parse(result.text);}catch{parsed=null;}
          const checked=schema.safeParse(parsed);if(checked.success){action=checked.data;break;}
          session.note('Planner output rejected by the current action schema.','rejected','llm_action_rejected','llm');
        }catch(error){signal.throwIfAborted();session.note(`Planner adapter failed (${safeLlmCode(error)}); switching to scripted coverage.`,'error');adapterFailed=true;break;}
      }
      if(!action){if(!adapterFailed)session.note('Planner output invalid twice; switching to scripted coverage.','rejected');break;}
      if(action.action==='finish')break;
      await session.execute(action,'llm');signal.throwIfAborted();
    }
  }
  await scriptedCoverage(session);signal.throwIfAborted();
}
