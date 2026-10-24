import type { QlooCallRecord, Receipt, Resolution, ResolveRequest, ResolveResponse, SearchCandidate } from '../shared/types';
import { normalize } from './normalize';
import { finite, object, receiptFor, recordedEntities } from './receipts';
export interface ResolutionEvidence { resolution: Resolution; receipts: Receipt[] }
/** Pure search interpretation. Confirmation integrity and resolve tokens belong to server. */
export function resolveName(call: QlooCallRecord, inputName: string, target: string): ResolutionEvidence {
  if(call.endpoint !== '/search') throw new Error('Expected search call');
  const requestedArtist=call.params.some(([k,v])=>k==='types'&&v.split(',').includes('urn:entity:artist'));
  const receipts:Receipt[]=[];
  const candidates:SearchCandidate[]=recordedEntities(call).slice(0,5).map(row=>{
    const receipt=receiptFor(call,`${row.path}.name`);receipts.push(receipt);
    const d=row.value.disambiguation??object(row.value.properties)?.disambiguation;
    return {entityId:row.identity.id,name:row.identity.name,subtype:row.identity.subtype,disambiguation:typeof d==='string'?d:null,popularity:finite(row.value.popularity)?row.value.popularity:null,receiptId:receipt.id};
  });
  const exact=candidates.filter(c=>normalize(inputName)!==''&&normalize(c.name)===normalize(inputName)&&(c.subtype==='urn:entity:artist'||c.subtype===null&&requestedArtist));
  const status=!candidates.length?'not_found':exact.length===1?'auto_matched':'needs_confirmation';
  return {resolution:{target,inputName,status,chosen:status==='auto_matched'?exact[0]:null,candidates,searchCallId:call.callId},receipts};
}
export type ResolveEvidence = Omit<ResolveResponse,'resolveId'>;
/** Calls must correspond exactly to input order: headliner then each roster row. No IO/store. */
export function resolveFromRecords(request: ResolveRequest, calls: readonly QlooCallRecord[]): ResolveEvidence {
  const inputs=[{target:'headliner',name:request.headlinerQuery},...request.roster.map(r=>({target:r.rowId,name:r.name}))];
  if(calls.length!==inputs.length)throw new Error('Search record coverage mismatch');
  const results=inputs.map((input,i)=>{const call=calls[i];if(!call.params.some(([k,v])=>k==='query'&&v===input.name))throw new Error('Search record query mismatch');return resolveName(call,input.name,input.target);});
  return {headliner:results[0].resolution,roster:results.slice(1).map(r=>r.resolution),receipts:results.flatMap(r=>r.receipts)};
}
