import { createServer,type Server,type RequestListener } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach,expect,it } from 'vitest';
import { HttpQlooClient } from '../../src/qloo/http-client';
import { parseEnv } from '../../src/server/env';
const servers:Server[]=[];const dirs:string[]=[];const sentinel='SENTINEL-QLOO-SECRET';
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function stub(handler:RequestListener){const server=createServer(handler);servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as any;return `http://127.0.0.1:${address.port}`;}
const search={query:'Fictional Artist',types:['urn:entity:artist'] as ['urn:entity:artist'],take:5};
async function client(url:string,cache=false,now?:()=>number){const dir=await mkdtemp(path.join(tmpdir(),'qloo-http-'));dirs.push(dir);return new HttpQlooClient({...parseEnv({QLOO_MODE:'live',QLOO_API_KEY:sentinel,QLOO_BASE_URL:url}).qloo,cacheDir:dir,cacheEnabled:cache,cacheTtlMs:100},{retryDelayMs:0,timeoutMs:200,now});}
it('Q5: GET, X-Api-Key only, retries 429 then succeeds without key in record',async()=>{
 let hits=0;const url=await stub((req,res)=>{hits++;expect(req.method).toBe('GET');expect(req.headers['x-api-key']).toBe(sentinel);expect(req.headers.authorization).toBeUndefined();expect(req.headers['content-length']).toBeUndefined();res.setHeader('content-type','application/json');if(hits===1){res.writeHead(429,{'retry-after':'1'});res.end('{}');}else res.end('{"results":[]}');});
 const record=await(await client(url)).search(search);expect(hits).toBe(2);expect(JSON.stringify(record)).not.toContain(sentinel);
});
it('Q5: 401 no retry, 429 max three and 500 max two, safe errors',async()=>{
 for(const [status,expected,code]of [[401,1,'qloo_auth'],[429,3,'qloo_rate_limited'],[500,2,'qloo_unavailable']] as const){let hits=0;const url=await stub((_req,res)=>{hits++;res.writeHead(status);res.end(sentinel);});try{await(await client(url)).search(search);throw new Error('Expected failure');}catch(e){expect(e).toMatchObject({code});expect(String(e)).not.toContain(sentinel);}expect(hits).toBe(expected);}
});
it('Q5: hanging upstream times out with test-only override',async()=>{const url=await stub(()=>{});await expect((await client(url)).search(search)).rejects.toMatchObject({code:'qloo_timeout'});});
it('v1.1: redirect never follows credential header, malformed/oversized/secret success rejected',async()=>{
 let redirected=0;const destination=await stub((_req,res)=>{redirected++;res.end('{}');});const url=await stub((_req,res)=>{res.writeHead(302,{location:destination});res.end();});await expect((await client(url)).search(search)).rejects.toMatchObject({code:'qloo_redirect_rejected'});expect(redirected).toBe(0);
 for(const [body,type,code]of [['<html>','text/html','qloo_malformed_response'],['{','application/json','qloo_malformed_response'],['{}','application/json','qloo_malformed_response'],[JSON.stringify({results:[],message:sentinel}),'application/json','qloo_unsafe_response'],['x'.repeat(2_000_001),'application/json','qloo_response_too_large']]){const u=await stub((_req,res)=>{res.setHeader('content-type',type);res.end(body);});await expect((await client(u)).search(search)).rejects.toMatchObject({code});}
});
it('Q7: scoped cache retains original fetch time, TTL expires',async()=>{let clock=1000,hits=0;const url=await stub((_req,res)=>{hits++;res.setHeader('content-type','application/json');res.end('{"results":[]}');});const c=await client(url,true,()=>clock);const first=await c.search(search);clock+=50;const second=await c.search(search);expect(second.origin).toBe('live-cache');expect(second.liveFetchedAt).toBe(first.liveFetchedAt);expect(hits).toBe(1);clock+=100;expect((await c.search(search)).origin).toBe('live');expect(hits).toBe(2);});
it('Q5: one network retry and caller cancellation stops further requests',async()=>{
 let hits=0;const url=await stub((req,res)=>{hits++;if(hits===1){req.socket.destroy();return;}res.setHeader('content-type','application/json');res.end('{"results":[]}');});expect((await(await client(url)).search(search)).httpStatus).toBe(200);expect(hits).toBe(2);
 const controller=new AbortController();controller.abort();await expect((await client(url)).search(search,controller.signal)).rejects.toThrow();expect(hits).toBe(2);
});
