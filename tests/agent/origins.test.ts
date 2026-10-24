import { expect,test } from 'vitest';
import { ResolveStore } from '../../src/server/resolve-store';
import { createApplicationServices } from '../../src/agent/services';
import { NoneLlmAdapter } from '../../src/agent/llm/adapter';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import { normalize } from '../../src/domain/normalize';
import { harness,request,confirmations } from './helpers';
test('origins: actual empty live-cache search metadata survives resolve put/verify clone and reaches Brief',async()=>{
  const client=new FixtureQlooClient(),original=client.search.bind(client);
  client.search=async(args,signal)=>{const recorded=await original(args,signal);return {...recorded,origin:args.query==='Echo Park Ferry'?'live-cache':'live',fixtureLabel:null,liveFetchedAt:'2026-10-17T00:00:00.000Z'};};
  const services=createApplicationServices((await import('../../src/server/env')).parseEnv({}),new NoneLlmAdapter());const input=request();const resolveInput={headlinerQuery:input.headlinerQuery,roster:input.roster.map(({rowId,name})=>({rowId,name}))};
  const evidence=await services.resolve(resolveInput,client,new AbortController().signal);expect(evidence.origins).toEqual(['live','live-cache']);expect(evidence.receipts.every(r=>r.origin==='live')).toBe(true);
  const store=new ResolveStore(normalize),id=store.put(resolveInput,evidence);evidence.origins!.length=0;
  const verified=store.verify(id,input,confirmations(evidence));expect(verified.evidence.origins).toEqual(['live','live-cache']);verified.evidence.origins!.length=0;expect(store.verify(id,input,confirmations(evidence)).evidence.origins).toEqual(['live','live-cache']);
  const h=await harness(new NoneLlmAdapter(),client);try{const run=await h.pending;expect(run.brief?.origins).toEqual(expect.arrayContaining(['live','live-cache','fixture']));}finally{h.store.close();}
});
