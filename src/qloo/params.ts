import generated from './param-schema.generated.json';
import type { InsightsType, ParamWarning, QueryParams } from '../shared/types';
import type { ParamDefinition } from '../../scripts/extract-param-schema';
export interface InsightsParams {
  type: InsightsType; interestEntityIds: string[]; resultEntityIds?: string[]; excludeEntityIds?: string[]; tagIds?: string[];
  locationPoint?: { lat: number; lon: number }; radiusM?: number; geocodeName?: string; take: number; extra?: QueryParams;
}
export interface ParamOptions { allowReferenceOnly?: boolean; live?: boolean }
export class QlooParamError extends Error {
  constructor(public code: string, public param: string) { super(`Invalid Qloo parameter ${param}: ${code}`); this.name = 'QlooParamError'; }
}
const fail = (param: string, code = 'invalid_value'): never => { throw new QlooParamError(code, param); };
export const canonicalQuery = (params: QueryParams) => new URLSearchParams(params).toString();
export const sortParams = (params: QueryParams): QueryParams => [...params].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
function list(param: string, values: string[], max: number, options: ParamOptions): string {
  if (!Array.isArray(values) || !values.length || values.length > max) fail(param);
  for (const v of values) if (typeof v !== 'string' || !v.trim() || /[,\s\x00-\x1f]/.test(v) || (options.live && /^(fx-|urn:tag:fixture:)/i.test(v))) fail(param, options.live && /^(fx-|urn:tag:fixture:)/i.test(v) ? 'fixture_id_in_live' : 'invalid_id');
  return values.join(',');
}
function matches(value: string, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.oneOf)) return schema.oneOf.some(s => matches(value, s));
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(s => matches(value, s));
  if (schema.type === 'array') return value.length > 0 && value.split(',').every(v => matches(v, (schema.items ?? {}) as Record<string, unknown>));
  if (schema.type === 'boolean' && !['true','false'].includes(value)) return false;
  if (schema.type === 'integer' || schema.type === 'number') {
    if (!value.trim() || !Number.isFinite(Number(value)) || (schema.type === 'integer' && !Number.isInteger(Number(value)))) return false;
    const n = Number(value);
    if (typeof schema.minimum === 'number' && n < schema.minimum || typeof schema.maximum === 'number' && n > schema.maximum || typeof schema.exclusiveMinimum === 'number' && n <= schema.exclusiveMinimum || typeof schema.exclusiveMaximum === 'number' && n >= schema.exclusiveMaximum) return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(v => String(v) === value)) return false;
  if (typeof schema.minLength === 'number' && value.length < schema.minLength || typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;
  return true;
}
function validate(params: QueryParams, definitions: Record<string, ParamDefinition>, options: ParamOptions) {
  const warnings: ParamWarning[] = [], seen = new Set<string>();
  for (const [key,value] of params) {
    if (seen.has(key)) fail(key, 'duplicate_key'); seen.add(key);
    if (key.startsWith('signal.demographics.')) fail(key, 'demographics_forbidden');
    if (key.endsWith('.query') && ['filter.results.entities.query','signal.interests.entities.query'].includes(key)) fail(key, 'intentionally_unsupported_locally');
    const def = definitions[key]; if (!def) fail(key, 'undocumented');
    if (def.tier !== 'guide') { if (!options.allowReferenceOnly) fail(key, 'tier_not_allowed'); warnings.push({param:key, tier:def.tier, message:'Reference-only parameter: not listed for this entity type in the guide.'}); }
    if (!matches(value, def.schema)) fail(key);
    if (/^(signal\.interests\.entities|filter\.(results|exclude)\.entities|filter\.(exclude\.)?tags|signal\.interests\.tags)$/.test(key)) list(key, value.split(','), key === 'filter.tags' ? 3 : key === 'signal.interests.entities' ? 5 : 50, options);
    if (key.includes('popularity') && (Number(value) < 0 || Number(value) > 1)) fail(key);
    if (key === 'filter.location') {
      const m = /^POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/.exec(value);
      if (!m || Math.abs(Number(m[1])) > 180 || Math.abs(Number(m[2])) > 90) fail(key);
    }
    if (key === 'filter.location.radius' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 800000)) fail(key);
  }
  for (const [key,def] of Object.entries(definitions)) if (def.required && !seen.has(key)) fail(key, 'required');
  if (seen.has('filter.location.radius') && !seen.has('filter.location')) fail('filter.location.radius', 'location_required');
  return {params:sortParams(params),warnings};
}
export function buildInsightsQuery(p: InsightsParams, options: ParamOptions = {}) {
  const defs = (generated.insights as Record<string, Record<string, ParamDefinition>>)[p.type];
  if (!defs) fail('filter.type');
  if (!Number.isInteger(p.take) || p.take < 1 || p.take > 50) fail('take');
  const params: QueryParams = [['filter.type',p.type],['signal.interests.entities',list('signal.interests.entities',p.interestEntityIds,5,options)],['take',String(p.take)]];
  if (p.resultEntityIds !== undefined) params.push(['filter.results.entities',list('filter.results.entities',p.resultEntityIds,50,options)]);
  if (p.excludeEntityIds !== undefined) params.push(['filter.exclude.entities',list('filter.exclude.entities',p.excludeEntityIds,50,options)]);
  if (p.tagIds !== undefined && p.tagIds.length) params.push(['filter.tags',list('filter.tags',p.tagIds,3,options)]);
  if (p.locationPoint) params.push(['filter.location',`POINT(${p.locationPoint.lon} ${p.locationPoint.lat})`]);
  if (p.radiusM !== undefined) params.push(['filter.location.radius',String(p.radiusM)]);
  if (p.geocodeName !== undefined) { if (!p.geocodeName.trim()) fail('filter.geocode.name'); params.push(['filter.geocode.name',p.geocodeName]); }
  params.push(...(p.extra ?? []));
  return validate(params,defs,options);
}
export function buildSearchQuery(args: {query:string;types:['urn:entity:artist'];take:number}) {
  if (!args.query.trim() || args.query.length > 120) fail('query');
  if (args.types.length !== 1 || args.types[0] !== 'urn:entity:artist') fail('types');
  if (!Number.isInteger(args.take) || args.take < 1 || args.take > 5) fail('take');
  return validate([['query',args.query],['types',args.types.join(',')],['take',String(args.take)]],generated.search as Record<string,ParamDefinition>,{});
}
export function buildTagsQuery(args: {query:string;take:number}) {
  if (!args.query.trim() || args.query.length > 40) fail('filter.query');
  if (!Number.isInteger(args.take) || args.take < 1 || args.take > 50) fail('take');
  return validate([['filter.query',args.query],['take',String(args.take)]],generated.tags as Record<string,ParamDefinition>,{});
}
