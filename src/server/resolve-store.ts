import { randomBytes } from 'node:crypto';
import type { BriefRequest, DataOrigin, ConfirmedResolutions, ResolveRequest, ResolveResponse, Resolution, SearchCandidate } from '../shared/types';
export class BoundaryError extends Error { constructor(public code:string,message:string,public httpStatus=400,public issues?:unknown){super(message);} }
export type ResolveEvidence=Omit<ResolveResponse,'resolveId'> & {origins?:DataOrigin[]};
interface Snapshot {input:ResolveRequest;evidence:ResolveEvidence;created:number}
export class ResolveStore {
  private entries=new Map<string,Snapshot>();
  constructor(private normalize:(name:string)=>string,private max=100,private ttlMs=30*60000,private now=Date.now){}
  private purge(){for(const [id,s]of this.entries)if(this.now()-s.created>=this.ttlMs)this.entries.delete(id);}
  put(input:ResolveRequest,evidence:ResolveEvidence):string {
    this.purge();while(this.entries.size>=this.max)this.entries.delete(this.entries.keys().next().value!);
    const resolveId='resolve_'+randomBytes(16).toString('hex');
    // Preserve exact row names/order; normalized headliner is sufficient under §19.
    this.entries.set(resolveId,{input:structuredClone({...input,headlinerQuery:this.normalize(input.headlinerQuery)}),evidence:structuredClone(evidence),created:this.now()});return resolveId;
  }
  verify(resolveId:string,request:BriefRequest,submitted:ConfirmedResolutions):{resolutions:ConfirmedResolutions;evidence:ResolveEvidence} {
    this.purge();const snapshot=this.entries.get(resolveId);
    const invalid=(reason:string,rowId?:string):never=>{throw new BoundaryError('invalid_request','Resolution no longer matches this request. Resolve names again.',400,[{rowId,reason}]);};
    if(!snapshot)invalid('unknown_or_expired_resolve');
    const s=snapshot!;
    if(this.normalize(request.headlinerQuery)!==s.input.headlinerQuery || JSON.stringify(request.roster.map(({rowId,name})=>({rowId,name})))!==JSON.stringify(s.input.roster))invalid('changed_identity');
    if(new Set(request.roster.map(r=>r.rowId)).size!==request.roster.length)invalid('duplicate_row');
    if(submitted.roster.length!==request.roster.length || new Set(submitted.roster.map(r=>r.rowId)).size!==request.roster.length)invalid('incomplete_or_duplicate_rows');
    const choose=(resolution:Resolution,entityId:string|null,status:string):SearchCandidate|null=>{
      if(status==='user_skipped'){if(resolution.target==='headliner')invalid('headliner_required');if(entityId!==null)invalid('invalid_transition',resolution.target);return null;}
      if(status==='not_found'){if(resolution.status!=='not_found'||entityId!==null)invalid('invalid_transition',resolution.target);return null;}
      if(!['auto_matched','user_confirmed'].includes(status)||!entityId)invalid('confirmation_required',resolution.target);
      const candidate=resolution.candidates.find(c=>c.entityId===entityId);
      if(!candidate)invalid('entity_not_from_search',resolution.target);
      if(status==='auto_matched'&&(resolution.status!=='auto_matched'||resolution.chosen?.entityId!==entityId))invalid('invalid_transition',resolution.target);
      if(!s.evidence.receipts.some(r=>r.id===candidate!.receiptId&&r.entity?.id===candidate!.entityId&&r.value===candidate!.name))invalid('candidate_evidence_missing',resolution.target);
      return candidate!;
    };
    const head=choose(s.evidence.headliner,submitted.headliner.entityId,'user_confirmed')!;
    const seen=new Set<string>();
    const roster=request.roster.map(row=>{
      const incoming=submitted.roster.find(r=>r.rowId===row.rowId);const resolution=s.evidence.roster.find(r=>r.target===row.rowId);
      if(!incoming||!resolution)invalid('missing_row',row.rowId);
      const c=choose(resolution!,incoming!.entityId,incoming!.status);
      if(c?.entityId===head.entityId)throw new BoundaryError('headliner_in_roster','The headliner cannot also be an opener.');
      if(c&&seen.has(c.entityId))invalid('duplicate_entity',row.rowId);
      if(c)seen.add(c.entityId);
      return {rowId:row.rowId,entityId:c?.entityId??null,name:c?.name??null,receiptId:c?.receiptId??null,status:incoming!.status};
    });
    if(!seen.size)throw new BoundaryError('no_ranked_roster','No roster entity was confirmed. Resolve and confirm at least one act.');
    return {resolutions:{headliner:{entityId:head.entityId,name:head.name,receiptId:head.receiptId},roster},evidence:structuredClone(s.evidence)};
  }
}
