import { z } from 'zod';
import type { PartnerCategory } from '../shared/types';
export type PlannerAction={action:'search_tags';query:string}|{action:'find_partners';category:PartnerCategory;tagIds:string[]}|{action:'finish'};
/** Transport-visible runtime enums are regenerated from this run's current observations. */
export function plannerActionSchema(categories:readonly PartnerCategory[],tagIds:readonly string[]) {
  const tags=[...new Set(tagIds)];
  return z.discriminatedUnion('action',[
    z.strictObject({action:z.literal('search_tags'),query:z.string().trim().min(1).max(40)}),
    z.strictObject({action:z.literal('find_partners'),category:z.enum([...categories]),tagIds:tags.length?z.array(z.enum(tags)).max(3).refine(a=>new Set(a).size===a.length,'Duplicate tags'):z.array(z.string()).length(0)}),
    z.strictObject({action:z.literal('finish')}),
  ]);
}
/** Order-insensitive tag sets and normalized query whitespace prevent cosmetic duplicate actions. */
export function actionKey(action:PlannerAction):string {
  return action.action==='search_tags'?JSON.stringify(['search_tags',action.query.trim().toLowerCase().replace(/\s+/g,' ')])
    :action.action==='find_partners'?JSON.stringify(['find_partners',action.category,[...action.tagIds].sort()]):'finish';
}
