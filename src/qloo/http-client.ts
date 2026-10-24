import { setTimeout as delay } from 'node:timers/promises';
import type { QlooClient } from './client';
import type { QlooEnv } from '../server/env';
import { validateQlooBaseUrl } from '../server/env';
import type { ParamWarning, QlooEndpoint, QueryParams } from '../shared/types';
import { buildInsightsQuery, buildSearchQuery, buildTagsQuery, canonicalQuery, type InsightsParams } from './params';
import { callRecord } from './record';
import { QlooCache } from './cache';
import { QlooError, upstreamError } from './errors';
export interface HttpClientTestOptions { timeoutMs?:number; retryDelayMs?:number; now?:()=>number; fetch?:typeof fetch }
function validateBody(bodyText:string, endpoint:QlooEndpoint) {
  let body: any; try { body=JSON.parse(bodyText); } catch { throw new QlooError('qloo_malformed_response','Qloo returned malformed JSON.',502); }
  const results = endpoint === '/search' ? (Array.isArray(body?.results) ? body.results : body?.results?.entities) : endpoint === '/v2/tags' ? (Array.isArray(body?.results) ? body.results : body?.results?.tags) : body?.results?.entities;
  if (!body || typeof body !== 'object' || body.success === false || !Array.isArray(results) || results.some((v:unknown)=>v === null || typeof v !== 'object' || Array.isArray(v))) throw new QlooError('qloo_malformed_response','Qloo returned an invalid success response shape.',502);
  return body;
}
async function boundedText(response:Response, maxBytes:number, signal:AbortSignal):Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new QlooError('qloo_response_too_large','Qloo response exceeded the size limit.',502); }
  const reader=response.body?.getReader(); if (!reader) return '';
  const chunks:Uint8Array[]=[]; let size=0;
  try { while(true){signal.throwIfAborted();const {done,value}=await reader.read(); if(done)break;size+=value.byteLength;if(size>maxBytes)throw new QlooError('qloo_response_too_large','Qloo response exceeded the size limit.',502);chunks.push(value);} }
  finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export class HttpQlooClient implements QlooClient {
  readonly mode='live' as const;
  private cache:QlooCache|null; private now:()=>number; private fetcher:typeof fetch; private baseUrl:string;
  constructor(private env:QlooEnv,private testOptions:HttpClientTestOptions={}) {
    if(!env.apiKey)throw new Error('QLOO_MODE=live requires QLOO_API_KEY (value not printed)');
    this.baseUrl=validateQlooBaseUrl(env.baseUrl);this.now=testOptions.now??Date.now;this.fetcher=testOptions.fetch??fetch;
    this.cache=env.cacheEnabled?new QlooCache(env.cacheDir,this.baseUrl,env.apiKey,env.cacheTtlMs,this.now):null;
  }
  private containsCredential(text:string) { const key=this.env.apiKey!;return [key,encodeURIComponent(key),JSON.stringify(key).slice(1,-1)].some(k=>text.includes(k)); }
  private async request(endpoint:QlooEndpoint,built:{params:QueryParams;warnings:ParamWarning[]},caller?:AbortSignal) {
    caller?.throwIfAborted();const query=canonicalQuery(built.params),canonicalUrl=`${endpoint}?${query}`;
    if(this.containsCredential(canonicalUrl))throw new QlooError('qloo_unsafe_request','Qloo request contains protected credential material.',400);
    const start=this.now(), requestedAt=new Date(start).toISOString();
    const cached=await this.cache?.get(canonicalUrl);caller?.throwIfAborted();
    if(cached && !this.containsCredential(cached.bodyText)) { try { const parsed=validateBody(cached.bodyText,endpoint);if(this.containsCredential(JSON.stringify(parsed)))throw new QlooError('qloo_unsafe_response','Unsafe cached response.',502);return callRecord(endpoint,built.params,cached.bodyText,{origin:'live-cache',status:cached.status,durationMs:0,requestedAt,liveFetchedAt:cached.liveFetchedAt,warnings:built.warnings}); } catch { /* Invalid private cache is a miss. */ } }
    let rateRetries=0, transientRetries=0;
    for(;;){
      caller?.throwIfAborted();const timeout=AbortSignal.timeout(this.testOptions.timeoutMs??15000);const signal=caller?AbortSignal.any([caller,timeout]):timeout;
      try {
        const response=await this.fetcher(`${this.baseUrl}${canonicalUrl}`,{method:'GET',headers:{'X-Api-Key':this.env.apiKey!,Accept:'application/json','User-Agent':'OpenerFit/0.1.0'},redirect:'manual',signal});
        if(response.status>=300 && response.status<400){await response.body?.cancel();throw new QlooError('qloo_redirect_rejected','Qloo redirect rejected to protect credentials.',502);}
        if(response.status===429 && rateRetries<2){const header=response.headers.get('retry-after');const seconds=header===null?NaN:Number(header);const wait=Number.isFinite(seconds)?Math.max(0,Math.min(10,seconds))*1000:[1000,3000][rateRetries];rateRetries++;await response.body?.cancel();await delay(this.testOptions.retryDelayMs??wait,undefined,{signal:caller});continue;}
        if(response.status>=500 && transientRetries<1){transientRetries++;await response.body?.cancel();await delay(this.testOptions.retryDelayMs??1000,undefined,{signal:caller});continue;}
        if(!response.ok){await response.body?.cancel();throw upstreamError(response.status);}
        const contentType=response.headers.get('content-type')??'';
        if(!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)){await response.body?.cancel();throw new QlooError('qloo_malformed_response','Qloo success response was not JSON.',502);}
        const bodyText=await boundedText(response,2_000_000,signal);signal.throwIfAborted();
        if(this.containsCredential(bodyText))throw new QlooError('qloo_unsafe_response','Qloo response contained protected credential material.',502);
        const parsed=validateBody(bodyText,endpoint);if(this.containsCredential(JSON.stringify(parsed)))throw new QlooError('qloo_unsafe_response','Qloo response contained protected credential material.',502);const liveFetchedAt=new Date(this.now()).toISOString();
        caller?.throwIfAborted();
        // Cache failure must not turn an otherwise valid upstream response into an invented failure.
        await this.cache?.put(canonicalUrl,{liveFetchedAt,status:response.status,bodyText}).catch(()=>{});
        caller?.throwIfAborted();
        return callRecord(endpoint,built.params,bodyText,{origin:'live',status:response.status,durationMs:this.now()-start,requestedAt,liveFetchedAt,warnings:built.warnings});
      } catch(error) {
        if(caller?.aborted)throw caller.reason;
        if(error instanceof QlooError)throw error;
        if(timeout.aborted)throw new QlooError('qloo_timeout','Qloo did not respond before the timeout.',504);
        if(transientRetries<1){transientRetries++;await delay(this.testOptions.retryDelayMs??1000,undefined,{signal:caller});continue;}
        throw new QlooError('qloo_network','Qloo could not be reached.',503);
      }
    }
  }
  search(args:Parameters<QlooClient['search']>[0],signal?:AbortSignal){return this.request('/search',buildSearchQuery(args),signal);}
  insights(args:InsightsParams,signal?:AbortSignal){return this.request('/v2/insights',buildInsightsQuery(args,{live:true}),signal);}
  tags(args:Parameters<QlooClient['tags']>[0],signal?:AbortSignal){return this.request('/v2/tags',buildTagsQuery(args),signal);}
  // Internal probe-only entry point; never wired to browser request fields.
  probeInsights(args:InsightsParams,signal?:AbortSignal){return this.request('/v2/insights',buildInsightsQuery(args,{live:true,allowReferenceOnly:true}),signal);}
}
