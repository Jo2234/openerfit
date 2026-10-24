import type { ResolveResponse, Resolution } from '../../shared/types';
import { COPY } from '../../shared/copy';
import { confirmChoices, SKIP, type Choices } from '../form-model';
export function Confirm({resolved,choices,onChange,onBack,onStart,pending}:{resolved:ResolveResponse;choices:Choices;onChange:(choices:Choices)=>void;onBack:()=>void;onStart:()=>void;pending:boolean}) {
  const selection=confirmChoices(resolved,choices);
  function card(resolution:Resolution,headliner=false){
    const auto=resolution.status==='auto_matched',notFound=resolution.status==='not_found';
    return <fieldset className={`paper match-card ${headliner?'headliner-match':''}`} key={resolution.target}><legend><span className="eyebrow">{headliner?'Headliner':'Roster act'}</span><span className="match-name">{resolution.inputName}</span></legend>
      <p className="match-status">{auto?'Exact unique match — review or override':notFound?(headliner?'No headliner match found. Edit the name and resolve again.':COPY.notFound):'Your confirmation is needed'}</p>
      {resolution.candidates.map(candidate=><label className={`candidate ${choices[resolution.target]===candidate.entityId?'selected':''}`} key={candidate.entityId}>
        <input type="radio" name={`match-${resolution.target}`} value={candidate.entityId} checked={choices[resolution.target]===candidate.entityId} disabled={pending} onChange={()=>onChange({...choices,[resolution.target]:candidate.entityId})}/>
        <span><strong>{candidate.name}</strong><span className="candidate-detail">{candidate.disambiguation??'No disambiguation provided'}</span><span className="candidate-detail">Popularity: {candidate.popularity===null?'not returned':String(candidate.popularity)} · {candidate.subtype??'artist search'}</span><code>{candidate.entityId}</code></span>
      </label>)}
      {!headliner&&!notFound&&<label className={`candidate skip-choice ${choices[resolution.target]===SKIP?'selected':''}`}><input type="radio" name={`match-${resolution.target}`} checked={choices[resolution.target]===SKIP} disabled={pending} onChange={()=>onChange({...choices,[resolution.target]:SKIP})}/>Skip this act</label>}
    </fieldset>;
  }
  return <section aria-label="Confirm artist identities"><div className="confirmation-intro"><p>Names can refer to different artists. Confirm the entities that belong on this bill. All choices are checked against this search on the server.</p><button type="button" className="text-button" disabled={pending} onClick={onBack}>← Edit event or roster</button></div>
    {card(resolved.headliner,true)}<div className="match-grid">{resolved.roster.map(r=>card(r))}</div>
    {!selection.confirmed&&<div className="confirmation-errors" role="status"><strong>Before you continue</strong><ul>{selection.errors.map((message,index)=><li key={index}>{message}</li>)}</ul></div>}
    <footer className="form-footer"><p>{selection.confirmed?`${selection.confirmed.roster.filter(r=>r.entityId).length} roster acts confirmed. Fees and bookability remain separate inputs.`:'Confirm the headliner and choose or skip each roster act.'}</p><button type="button" className="primary" disabled={!selection.confirmed||pending} onClick={onStart}>{pending?'Starting brief…':'Build brief'}<span aria-hidden="true"> →</span></button></footer>
  </section>;
}
