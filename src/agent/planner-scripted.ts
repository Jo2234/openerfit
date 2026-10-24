import type { PartnerCategory } from '../shared/types';
import { actionKey } from './protocol';
import type { ToolSession } from './tools';
/** Coverage never fabricates an empty successful category or exceeds the shared guards. */
export async function scriptedCoverage(session:ToolSession):Promise<void> {
  for(const category of ['brand','place','podcast'] as PartnerCategory[]){
    session.context.signal.throwIfAborted();
    if(!session.context.run.request.partnerCategories.includes(category)||session.partners.has(category))continue;
    const action={action:'find_partners' as const,category,tagIds:[]};
    if(session.finds[category]>=2||session.seen.has(actionKey(action))){
      const note=`No successful ${category} partner call; coverage cannot repeat a prior action or exceed its budget.`;
      session.observations.push(note);session.note(note);continue;
    }
    await session.execute(action,'scripted');session.context.signal.throwIfAborted();
  }
}
