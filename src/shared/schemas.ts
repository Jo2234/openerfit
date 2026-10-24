import { z } from 'zod';
import type { BriefRequest, ConfirmedResolutions, ResolveRequest, RunOptions } from './types';
const name = z.string().trim().min(1).max(120);
const id = z.string().min(1).max(200);
const nonnegative = z.number().finite().min(0).nullable();
export const bookabilitySchema = z.enum(['available', 'unavailable', 'unknown']);
export const resolutionStatusSchema = z.enum(['auto_matched', 'needs_confirmation', 'user_confirmed', 'not_found', 'user_skipped']);
export const partnerCategorySchema = z.enum(['brand', 'place', 'podcast']);
export const rosterEntrySchema = z.strictObject({ rowId: id, name, feeAmount: nonnegative, bookability: bookabilitySchema, notes: z.string().max(200) });
export const venueSchema = z.strictObject({ name, city: z.string().trim().min(1).max(80), lat: z.number().min(-90).max(90).nullable(), lon: z.number().min(-180).max(180).nullable(), radiusM: z.number().int().min(100).max(50000), capacity: z.number().int().min(1).max(100000).nullable() }).refine(v => (v.lat === null) === (v.lon === null), 'Coordinates must both be set or both be null');
export const budgetSchema = z.strictObject({ perOpenerMax: nonnegative, currency: z.string().regex(/^[A-Z]{3}$/) });
export const briefRequestSchema: z.ZodType<BriefRequest> = z.strictObject({ headlinerQuery: name, venue: venueSchema, budget: budgetSchema, showDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s; }, 'Invalid date').nullable(), roster: z.array(rosterEntrySchema).min(1).max(25), goal: z.string().max(500), partnerCategories: z.array(partnerCategorySchema).min(1).max(3).refine(a => new Set(a).size === a.length, 'Duplicate categories') });
export const resolveRequestSchema: z.ZodType<ResolveRequest> = z.strictObject({ headlinerQuery: name, roster: z.array(z.strictObject({ rowId: id, name })).min(1).max(25) });
const chosenSchema = z.strictObject({ entityId: id, name, receiptId: id });
export const confirmedResolutionsSchema: z.ZodType<ConfirmedResolutions> = z.strictObject({ headliner: chosenSchema, roster: z.array(z.strictObject({ rowId: id, entityId: id.nullable(), name: name.nullable(), receiptId: id.nullable(), status: resolutionStatusSchema })).min(1).max(25) });
export const runOptionsSchema: z.ZodType<RunOptions> = z.strictObject({ planner: z.enum(['auto', 'scripted']), baseline: z.boolean() });
export const createRunRequestSchema = z.strictObject({ resolveId: z.string().regex(/^resolve_[a-f0-9]{32}$/), request: briefRequestSchema, resolutions: confirmedResolutionsSchema, options: runOptionsSchema });
export const queryParamsSchema = z.array(z.tuple([z.string(), z.string()]));
export const claimRefSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('receipt'), receiptId: id }), z.strictObject({ kind: z.literal('user_input'), field: z.enum(['fee', 'budget', 'bookability', 'capacity', 'show_date', 'notes']), rowId: id.nullable() })]);
export const claimSchema = z.strictObject({ id, section: z.enum(['openers', 'partners', 'caveats']), text: z.string().min(1).max(280), refs: z.array(claimRefSchema).min(1), author: z.enum(['llm', 'template']) });
// The v1.1 writer can only choose existing facts. Never accept arbitrary factual prose.
export function claimSelectionSchema(catalogueIds: string[]) {
  const allowedIds = [...new Set(catalogueIds)];
  // A refinement alone disappears from z.toJSONSchema. Keep catalogue membership
  // in a transport-visible enum; no catalogue means only an empty list is valid.
  const claimIds = allowedIds.length
    ? z.array(z.enum(allowedIds)).max(12).refine(a => new Set(a).size === a.length, 'Duplicate claim ID')
    : z.array(z.string()).length(0);
  return z.strictObject({ claimIds });
}
export const baselineOutputSchema = z.strictObject({ openerRanking: z.array(name).max(25), partners: z.strictObject({ brand: z.array(name).max(5), place: z.array(name).max(5), podcast: z.array(name).max(5) }), rationale: z.array(z.string().max(300)).max(8) });
export const dataOriginSchema = z.enum(['fixture', 'live', 'live-cache']);
export const receiptSchema = z.strictObject({ id, callId: id, endpoint: z.enum(['/search', '/v2/insights', '/v2/tags']), params: queryParamsSchema, origin: dataOriginSchema, fixtureLabel: z.string().nullable(), valuePath: z.string().min(1), value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]), rawValueText: z.string(), entity: z.strictObject({ id, name: z.string(), subtype: z.string().nullable() }).nullable(), liveFetchedAt: z.iso.datetime().nullable(), requestedAt: z.iso.datetime() });

// Server/domain/agent output contracts. Schemas validate evidence shape; only
// domain receiptFor may establish value provenance, and the catalogue controls text.
const timestamp = z.iso.datetime();
const nullableString = z.string().nullable();
const endpointSchema = z.enum(['/search', '/v2/insights', '/v2/tags']);
export const paramWarningSchema = z.strictObject({ param: z.string(), tier: z.enum(['guide','reference_only','undocumented']), message: z.string() });
export const qlooCallRecordSchema = z.strictObject({ callId: id, endpoint: endpointSchema, params: queryParamsSchema, canonicalUrl:z.string(), origin:dataOriginSchema,fixtureLabel:nullableString,httpStatus:z.number().int(),durationMs:z.number().min(0),requestedAt:timestamp,liveFetchedAt:timestamp.nullable(),responseSha256:z.string().regex(/^[a-f0-9]{64}$/),body:z.unknown(),paramWarnings:z.array(paramWarningSchema) });
export const searchCandidateSchema = z.strictObject({ entityId:id,name:z.string(),subtype:nullableString,disambiguation:nullableString,popularity:z.number().finite().nullable(),receiptId:id });
export const resolutionSchema = z.strictObject({ target:id,inputName:z.string(),status:resolutionStatusSchema,chosen:searchCandidateSchema.nullable(),candidates:z.array(searchCandidateSchema).max(5),searchCallId:id }).refine(r => (r.chosen !== null) === ['auto_matched','user_confirmed'].includes(r.status),'Chosen candidate/status mismatch');
export const resolveResponseSchema = z.strictObject({resolveId:z.string().regex(/^resolve_[a-f0-9]{32}$/),headliner:resolutionSchema,roster:z.array(resolutionSchema).max(25),receipts:z.array(receiptSchema)});
export const openerRowSchema = z.strictObject({rowId:id,inputName:z.string(),entityId:id.nullable(),qlooName:nullableString,status:z.enum(['ranked','no_affinity_returned','not_in_qloo','skipped']),affinity:z.number().finite().nullable(),affinityReceiptId:id.nullable(),affinityRank:z.number().int().min(1).nullable(),qlooOrder:z.number().int().min(0).nullable(),outOfRange:z.boolean(),bookability:bookabilitySchema,feeAmount:nonnegative,withinBudget:z.boolean().nullable(),shortlistEligible:z.boolean()});
export const rosterRankingSchema = z.strictObject({headliner:chosenSchema,rows:z.array(openerRowSchema).max(25),recommendedRowIds:z.array(id).max(3),rankingCallId:id,uncertainty:z.array(z.string())});
export const partnerItemSchema = z.strictObject({entityId:id,name:z.string(),category:partnerCategorySchema,affinity:z.number().finite().nullable(),affinityReceiptId:id.nullable(),qlooOrder:z.number().int().min(0),address:nullableString,distanceM:z.number().int().min(0).nullable(),tags:z.array(z.strictObject({id,name:z.string()})).max(5)});
export const partnerShortlistSchema = z.strictObject({category:partnerCategorySchema,scope:z.enum(['global_taste','near_venue_point','city_name_match']),scopeNote:z.string(),tagFilter:z.array(z.strictObject({id,name:z.string(),receiptId:id})).max(3),items:z.array(partnerItemSchema).max(8),callId:id,planner:z.enum(['llm','scripted']),uncertainty:z.array(z.string())});
export const claimViolationSchema = z.strictObject({rule:z.enum(['EMPTY','TOO_LONG','NO_REFS','UNKNOWN_RECEIPT','NUMBER_NOT_IN_REFS','ENTITY_NOT_IN_REFS','FORBIDDEN_CLAIM','USER_FIELD_MISSING']),detail:z.string(),lexiconId:z.string().optional()});
export const claimCheckSchema = z.strictObject({claimId:id,ok:z.boolean(),violations:z.array(claimViolationSchema)});
export const writerInfoSchema = z.strictObject({kind:z.enum(['llm','template']),source:z.enum(['llm','fixture']).nullable(),fixtureLabel:nullableString,model:nullableString,promptVersion:nullableString,attempts:z.number().int().min(0),fallbackReason:nullableString});
export const briefSchema = z.strictObject({runId:id,createdAt:timestamp,request:briefRequestSchema,ranking:rosterRankingSchema,partners:z.array(partnerShortlistSchema).max(3),systemNotes:z.array(z.string()),claims:z.array(claimSchema),droppedClaims:z.array(z.strictObject({claim:claimSchema,check:claimCheckSchema})),writer:writerInfoSchema,receipts:z.array(receiptSchema),origins:z.array(dataOriginSchema),disclaimer:z.string()});
const errorSchema=z.strictObject({code:z.string(),message:z.string()});
export const baselineResultSchema=z.strictObject({status:z.enum(['ok','unavailable','invalid_output','error']),source:z.enum(['llm','fixture']).nullable(),model:nullableString,fixtureLabel:nullableString,promptVersion:nullableString,output:baselineOutputSchema.nullable(),error:errorSchema.nullable(),latencyMs:z.number().min(0).nullable()});
const partnerDiff=z.strictObject({matchedQloo:z.array(z.string()),noReceipt:z.array(z.string())});
export const baselineDiffSchema=z.strictObject({rows:z.array(z.strictObject({rowId:id,name:z.string(),baselinePos:z.number().int().min(1).nullable(),qlooRank:z.number().int().min(1).nullable(),delta:z.number().int().nullable()})),kendallTau:z.number().min(-1).max(1).nullable(),changedPositions:z.number().int().min(0),baselineNotInRoster:z.array(z.string()),partners:z.strictObject({brand:partnerDiff,place:partnerDiff,podcast:partnerDiff}),baselineCopyViolations:z.array(z.strictObject({text:z.string(),lexiconId:z.string()}))});
export const runStateSchema=z.enum(['queued','ranking','partners','writing','baseline','done','failed','cancelled']);
export const agentStepSchema=z.strictObject({index:z.number().int().min(0),planner:z.enum(['llm','scripted','system']),kind:z.enum(['tool_call','llm_action_rejected','note']),tool:z.enum(['rank_roster','search_tags','find_partners']).nullable(),args:z.record(z.string(),z.unknown()).nullable(),status:z.enum(['ok','error','rejected']),summary:z.string(),callIds:z.array(id),receiptIds:z.array(id),durationMs:z.number().min(0),error:errorSchema.nullable()});
export const runSchema=z.strictObject({id:z.string().regex(/^run_[a-f0-9]{32}$/),state:runStateSchema,request:briefRequestSchema,resolutions:confirmedResolutionsSchema,options:runOptionsSchema,steps:z.array(agentStepSchema),brief:briefSchema.nullable(),baseline:baselineResultSchema.nullable(),diff:baselineDiffSchema.nullable(),error:errorSchema.nullable(),startedAt:timestamp,finishedAt:timestamp.nullable(),qlooCallCount:z.number().int().min(0).max(14)});
