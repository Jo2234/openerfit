import { z } from 'zod';
import { briefRequestSchema, receiptSchema, resolveResponseSchema, runSchema } from '../shared/schemas';
import type { CreateRunRequest, ResolveRequest, Run } from '../shared/types';
import { COPY } from '../shared/copy';

const healthSchema = z.object({
  ok:z.boolean(), qloo:z.object({mode:z.enum(['fixture','live']),keyPresent:z.boolean(),baseUrl:z.string()}),
  llm:z.object({mode:z.enum(['none','fixture','openai-compatible']),model:z.string().nullable(),reachable:z.boolean().nullable()}),
});
const scenarioSchema = z.object({id:z.string(),title:z.string(),synthetic:z.boolean(),liveSafe:z.boolean(),request:briefRequestSchema});
export type Health = z.infer<typeof healthSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export class ApiError extends Error {
  constructor(public code:string, public status=0) { super(code); }
}
export function errorCopy(error:unknown): string {
  const code = error instanceof ApiError ? error.code : 'network';
  if(code==='qloo_auth')return COPY.qlooAuth;
  if(code==='qloo_rate_limited')return COPY.qlooRateLimited;
  if(code==='rate_limited')return 'This demo limits runs per hour to protect the shared API quota. Please try again later.';
  if(code==='fixture_missing')return 'This query is outside the synthetic demo coverage. Load the supplied example and use its default matches and location. Fee and availability edits are supported.';
  if(code==='invalid_request')return 'Your matches may have expired or the roster changed. Resolve names again before building the brief.';
  if(code==='headliner_in_roster')return 'The headliner cannot also be an opener. Choose a different match or skip that act.';
  if(code==='duplicate_roster_name')return 'Two roster names identify the same act. Edit the roster and resolve again.';
  if(code==='no_ranked_roster')return COPY.noRankedRoster;
  if(code==='run_not_found')return 'This run has expired from this server. Your form is still here; resolve names to start again.';
  if(code==='run_failed'||code==='tool_error')return 'The run could not be completed. Nothing was invented. Return to your roster and try again.';
  if(code==='receipt_not_found')return 'This receipt is not available for the completed run. Return to the brief or try again.';
  if(code==='integration_unavailable')return 'The booking service is unavailable on this server. Please try again later.';
  if(code==='run_finished')return 'This run has already finished. Its latest result has been requested.';
  if(code.startsWith('qloo_'))return COPY.qlooUnavailable;
  if(code==='invalid_response')return 'The server returned an unexpected response. Your inputs are preserved. Please retry.';
  return 'The server could not be reached. Your inputs are preserved. Please retry when the connection is back.';
}
async function json<T>(url:string, schema:z.ZodType<T>, signal?:AbortSignal, body?:unknown):Promise<T> {
  let response:Response;
  try { response=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal}); }
  catch(error){if(signal?.aborted)throw error;throw new ApiError('network');}
  let value:unknown;try {value=await response.json();}catch {throw new ApiError('invalid_response',response.status);}
  if(!response.ok){const error=z.object({error:z.object({code:z.string()})}).safeParse(value);throw new ApiError(error.success?error.data.error.code:'request_failed',response.status);}
  const parsed=schema.safeParse(value);if(!parsed.success)throw new ApiError('invalid_response',response.status);return parsed.data;
}
const runPath=(id:string)=>`/api/runs/${encodeURIComponent(id)}`;
export const api = {
  health:(signal?:AbortSignal)=>json('/api/health',healthSchema,signal),
  scenarios:(signal?:AbortSignal)=>json('/api/scenarios',z.array(scenarioSchema),signal),
  resolve:(request:ResolveRequest,signal?:AbortSignal)=>json('/api/resolve',resolveResponseSchema,signal,request),
  start:(request:CreateRunRequest,signal?:AbortSignal)=>json('/api/runs',z.object({runId:z.string().regex(/^run_[a-f0-9]{32}$/)}),signal,request),
  run:(id:string,signal?:AbortSignal):Promise<Run>=>json(runPath(id),runSchema,signal),
  cancel:(id:string,signal?:AbortSignal)=>json(`${runPath(id)}/cancel`,z.object({state:z.literal('cancelled')}),signal,{}),
  receipt:(id:string,rid:string,signal?:AbortSignal)=>json(`${runPath(id)}/receipts/${encodeURIComponent(rid)}`,z.object({receipt:receiptSchema,entityExcerpt:z.unknown().nullable()}),signal),
  events:(id:string)=>`${runPath(id)}/events`,
  export:(id:string,format:'md'|'html')=>`${runPath(id)}/export.${format}`,
};
export type BookingApi=typeof api;
