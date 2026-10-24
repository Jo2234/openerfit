import type { AppEnv } from '../server/env';
import type { ApplicationServices } from '../server/app';
import type { QlooCallRecord } from '../shared/types';
import { normalize } from '../domain/normalize';
import { resolveFromRecords } from '../domain/resolve';
import { exportBrief } from '../domain/brief';
import { createLlmAdapter,type LlmAdapter } from './llm/adapter';
import { executeRun } from './run';
/** Real production services; the server provides capability stores and counted abort-aware clients. */
export function createApplicationServices(env:AppEnv,adapter:LlmAdapter=createLlmAdapter(env.llm)):ApplicationServices {
  return {normalize,exportBrief,
    resolve:async(request,client,signal)=>{
      const calls:QlooCallRecord[]=[];
      for(const query of [request.headlinerQuery,...request.roster.map(r=>r.name)]){
        signal.throwIfAborted();const call=await client.search({query,types:['urn:entity:artist'],take:5},signal);signal.throwIfAborted();calls.push(call);
      }
      return {...resolveFromRecords(request,calls),origins:[...new Set(calls.map(call=>call.origin))]};
    },
    execute:context=>executeRun(context,adapter,env.llm),
  };
}
