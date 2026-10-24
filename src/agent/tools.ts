import type { ExecutionContext } from '../server/app';
import type { AgentStep, DataOrigin, PartnerCategory, PartnerShortlist, QlooCallRecord, Receipt, RosterRanking, ToolName } from '../shared/types';
import { PARTNER_TYPE } from '../shared/types';
import { rankRosterEvidence } from '../domain/rank';
import { buildShortlistEvidence } from '../domain/partners';
import { tagObservations } from '../domain/receipts';
import { QlooError } from '../qloo/errors';
import { QlooParamError } from '../qloo/params';
import { actionKey,type PlannerAction } from './protocol';
type ToolAction=Exclude<PlannerAction,{action:'finish'}>;
/** All mutable registries and budgets are per-run. Never construct a client inside a run. */
export class ToolSession {
  readonly receipts=new Map<string,Receipt>();readonly origins=new Set<DataOrigin>();
  readonly tags=new Map<string,{id:string;name:string;receiptId:string}>();
  readonly partners=new Map<PartnerCategory,PartnerShortlist>();readonly steps:AgentStep[]=[];
  readonly observations:string[]=[];readonly seen=new Set<string>();
  readonly finds:Record<PartnerCategory,number>={brand:0,place:0,podcast:0};
  tagSearches=0;callCount=0;ranking:RosterRanking|null=null;
  constructor(readonly context:ExecutionContext){for(const origin of context.searchOrigins??[])this.origins.add(origin);for(const receipt of context.searchReceipts){this.receipts.set(receipt.id,receipt);this.origins.add(receipt.origin);}}
  private check(){this.context.signal.throwIfAborted();}
  private count(){this.check();if(this.callCount>=14)throw new Error('Run Qloo call budget exhausted');this.callCount++;}
  private record(call:QlooCallRecord){this.check();this.origins.add(call.origin);}
  private retain(receipts:Receipt[]){for(const receipt of receipts)this.receipts.set(receipt.id,receipt);}
  emit(step:Omit<AgentStep,'index'>):AgentStep {
    this.check();const indexed={...step,index:this.steps.length};
    if(!this.context.step(indexed)){this.check();throw new Error('Run is terminal');}
    this.steps.push(indexed);return indexed;
  }
  note(summary:string,status:AgentStep['status']='ok',kind:AgentStep['kind']='note',planner:AgentStep['planner']='system') {
    return this.emit({planner,kind,tool:null,args:null,status,summary,callIds:[],receiptIds:[],durationMs:0,error:null});
  }
  async rank():Promise<RosterRanking> {
    this.check();if(this.steps.length||this.ranking)throw new Error('Ranking must be step zero exactly once');
    const {run,client,signal}=this.context;
    const ids=run.request.roster.flatMap(row=>{const match=run.resolutions.roster.find(r=>r.rowId===row.rowId);return match?.entityId?[match.entityId]:[];});
    if(!ids.length)throw new Error('No confirmed roster entities');
    this.count();const started=performance.now();
    const call=await client.insights({type:'urn:entity:artist',interestEntityIds:[run.resolutions.headliner.entityId],resultEntityIds:ids,take:Math.max(1,ids.length)},signal);
    this.check();this.record(call);const result=rankRosterEvidence(call,run.resolutions,run.request);this.ranking=result.ranking;this.retain(result.receipts);
    this.emit({planner:'system',kind:'tool_call',tool:'rank_roster',args:{},status:'ok',summary:`Ranked ${result.ranking.rows.filter(r=>r.status==='ranked').length} of ${run.request.roster.length} roster acts.`,callIds:[call.callId],receiptIds:result.receipts.map(r=>r.id),durationMs:performance.now()-started,error:null});
    return result.ranking;
  }
  reject(action:ToolAction,planner:'llm'|'scripted',reason:string) {
    return this.emit({planner,kind:'llm_action_rejected',tool:action.action,args:{...action},status:'rejected',summary:reason,callIds:[],receiptIds:[],durationMs:0,error:{code:'action_rejected',message:reason}});
  }
  async execute(action:ToolAction,planner:'llm'|'scripted'):Promise<AgentStep> {
    this.check();const key=actionKey(action);const {run,client,signal}=this.context;
    if(this.seen.has(key))return this.reject(action,planner,'Duplicate tool action rejected.');
    if(action.action==='search_tags'&&this.tagSearches>=3)return this.reject(action,planner,'Tag search budget exhausted.');
    if(action.action==='find_partners'){
      if(!run.request.partnerCategories.includes(action.category))return this.reject(action,planner,'Category is not permitted.');
      if(action.tagIds.length>3||new Set(action.tagIds).size!==action.tagIds.length||action.tagIds.some(id=>!this.tags.has(id)))return this.reject(action,planner,'Tag ID was not observed in this run.');
      if(this.finds[action.category]>=2)return this.reject(action,planner,'Category call budget exhausted.');
    }
    this.seen.add(key);if(action.action==='search_tags')this.tagSearches++;else this.finds[action.category]++;
    const started=performance.now();const callIds:string[]=[];let receiptIds:string[]=[];
    try{
      this.count();let summary:string;
      if(action.action==='search_tags'){
        const call=await client.tags({query:action.query,take:10},signal);this.check();this.record(call);callIds.push(call.callId);
        const result=tagObservations(call);this.retain(result.receipts);receiptIds=result.receipts.map(r=>r.id);
        for(const tag of result.tags)if(!this.tags.has(tag.id))this.tags.set(tag.id,tag);
        summary=`Observed ${result.tags.length} tag IDs.`;
      }else{
        const rosterIds=run.request.roster.flatMap(row=>{const r=run.resolutions.roster.find(r=>r.rowId===row.rowId);return r?.entityId?[r.entityId]:[];});
        const {venue}=run.request;const headliner=run.resolutions.headliner.entityId;
        const location=action.category!=='place'?{}:venue.lat!==null&&venue.lon!==null?{locationPoint:{lat:venue.lat,lon:venue.lon},radiusM:venue.radiusM}:{geocodeName:venue.city};
        const call=await client.insights({type:PARTNER_TYPE[action.category],interestEntityIds:[headliner],excludeEntityIds:[headliner,...rosterIds],...(action.tagIds.length?{tagIds:[...action.tagIds].sort()}:{}),...location,take:8},signal);
        this.check();this.record(call);callIds.push(call.callId);
        const tagFilter=action.tagIds.map(id=>this.tags.get(id)!);
        const result=buildShortlistEvidence(call,action.category,venue,tagFilter,planner,rosterIds);
        this.retain(result.receipts);receiptIds=[...tagFilter.map(t=>t.receiptId),...result.receipts.map(r=>r.id)];this.partners.set(action.category,result.shortlist);
        summary=`Found ${result.shortlist.items.length} ${action.category} partners${action.tagIds.length?' with observed tag filters':''}.`;
      }
      return this.emit({planner,kind:'tool_call',tool:action.action,args:{...action},status:'ok',summary,callIds,receiptIds,durationMs:performance.now()-started,error:null});
    }catch(error){
      this.check();const code=error instanceof QlooError||error instanceof QlooParamError?error.code:'tool_error';
      const message=`${action.action} failed (${code}); no result was invented.`;this.observations.push(message);
      return this.emit({planner,kind:'tool_call',tool:action.action,args:{...action},status:'error',summary:message,callIds,receiptIds,durationMs:performance.now()-started,error:{code,message}});
    }
  }
}
