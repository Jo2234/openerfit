import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { QlooClient } from './client';
import type { ParamWarning, QlooEndpoint, QueryParams } from '../shared/types';
import { buildInsightsQuery, buildSearchQuery, buildTagsQuery, canonicalQuery, type InsightsParams } from './params';
import { callRecord } from './record';
import { QlooError } from './errors';
interface Index { synthetic:true; label:string; entries:{endpoint:QlooEndpoint;canonicalQuery:string;file:string;status:number}[] }
export class FixtureQlooClient implements QlooClient {
  readonly mode = 'fixture' as const;
  private indices: Promise<{index:Index;dir:string}[]> | null = null;
  constructor(private root = path.resolve('fixtures/qloo')) {}
  private load() { return this.indices ??= readdir(this.root,{withFileTypes:true}).then(async dirs => Promise.all(dirs.filter(d=>d.isDirectory()).map(async d=>{const dir=path.join(this.root,d.name);const index=JSON.parse(await readFile(path.join(dir,'index.json'),'utf8')) as Index;if(index.synthetic !== true || !index.label) throw new QlooError('fixture_invalid','Fixture index must be labelled synthetic.',500);return {index,dir};}))); }
  private async request(endpoint:QlooEndpoint, built:{params:QueryParams;warnings:ParamWarning[]}, signal?:AbortSignal) {
    signal?.throwIfAborted(); const query=canonicalQuery(built.params);
    const matches=(await this.load()).flatMap(({index,dir})=>index.entries.filter(e=>e.endpoint===endpoint && e.canonicalQuery===query).map(entry=>({entry,index,dir})));
    if (matches.length !== 1) throw new QlooError('fixture_missing',`No exact synthetic fixture coverage for ${endpoint}?${query}. Use the documented default demo selections.`,500);
    const {entry,index,dir}=matches[0]; if (path.basename(entry.file)!==entry.file) throw new QlooError('fixture_invalid','Invalid fixture file.',500);
    const bodyText=await readFile(path.join(dir,entry.file),'utf8'); signal?.throwIfAborted();
    return callRecord(endpoint,built.params,bodyText,{origin:'fixture',fixtureLabel:index.label,status:entry.status,durationMs:0,requestedAt:new Date().toISOString(),liveFetchedAt:null,warnings:built.warnings});
  }
  search(args:Parameters<QlooClient['search']>[0],signal?:AbortSignal){return this.request('/search',buildSearchQuery(args),signal);}
  insights(args:InsightsParams,signal?:AbortSignal){return this.request('/v2/insights',buildInsightsQuery(args),signal);}
  tags(args:Parameters<QlooClient['tags']>[0],signal?:AbortSignal){return this.request('/v2/tags',buildTagsQuery(args),signal);}
}
