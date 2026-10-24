import { createHash } from 'node:crypto';
import type { DataOrigin, ParamWarning, QlooCallRecord, QlooEndpoint, QueryParams } from '../shared/types';
import { canonicalQuery } from './params';
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
let sequence = 0;
export function callRecord(endpoint: QlooEndpoint, params: QueryParams, bodyText: string, options: {origin:DataOrigin; fixtureLabel?:string|null; status:number;durationMs:number;requestedAt:string;liveFetchedAt:string|null;warnings:ParamWarning[]}): QlooCallRecord {
  const canonicalUrl = `${endpoint}?${canonicalQuery(params)}`;
  return {callId:'C-'+sha256(`${canonicalUrl}\n${options.requestedAt}\n${++sequence}`).slice(0,12),endpoint,params,canonicalUrl,origin:options.origin,fixtureLabel:options.fixtureLabel??null,httpStatus:options.status,durationMs:options.durationMs,requestedAt:options.requestedAt,liveFetchedAt:options.liveFetchedAt,responseSha256:sha256(bodyText),body:JSON.parse(bodyText),paramWarnings:options.warnings};
}
