import { useState } from 'react';
import type { BaselineDiff, BaselineResult, Brief, PartnerCategory, Receipt, Run } from '../../shared/types';
import { COPY } from '../../shared/copy';
import { api } from '../api';
import { ReceiptChip } from './receipt';
import { BaselineProvenance, WriterProvenance } from './provenance';
const categoryName:Record<PartnerCategory,string>={brand:'Brands',place:'Places',podcast:'Podcasts'};
export const money=(value:number|null,currency:string)=>value===null?'Unknown':`${value.toLocaleString('en',{maximumFractionDigits:2})} ${currency}`;
function Affinity({value,outOfRange=false,receiptId,receipts,onReceipt}:{value:number|null;outOfRange?:boolean;receiptId:string|null;receipts:Receipt[];onReceipt:(id:string)=>void}) {
  return <div className="affinity-cell"><span className={`affinity ${value===null?'unscored':''}`}>{value===null?COPY.noAffinity:outOfRange?String(value):value.toFixed(3)}</span>{outOfRange&&<span className="warning-label">⚠ {COPY.outOfRange}</span>}{receiptId&&<ReceiptChip id={receiptId} receipt={receipts.find(r=>r.id===receiptId)} ready onOpen={onReceipt}/>}</div>;
}
export function Ranking({brief,onReceipt}:{brief:Brief;onReceipt:(id:string)=>void}) {
  return <section className="paper result-section" aria-labelledby="ranking-title"><div className="section-heading"><span className="section-number">01</span><div><p className="eyebrow">Your own roster, in returned affinity order</p><h3 id="ranking-title">Opener ranking</h3></div><span className="count-tag">{brief.ranking.rows.length} acts</span></div>
    <p className="section-note">Affinity is shown to three decimals; each receipt preserves the exact returned value. Shortlisting excludes unavailable and over-budget acts.</p>
    <div className="table-scroll" role="region" aria-label="Opener affinity ranking" tabIndex={0}><table className="ranking-table"><thead><tr><th scope="col">Rank</th><th scope="col">Act</th><th scope="col">Taste affinity</th><th scope="col">Your fee</th><th scope="col">Your bookability</th><th scope="col">Budget check</th></tr></thead><tbody>{brief.ranking.rows.map(row=><tr key={row.rowId} data-recommended={brief.ranking.recommendedRowIds.includes(row.rowId)||undefined}>
      <td className="rank-number">{row.affinityRank===null?'—':`#${row.affinityRank}`}</td><th scope="row"><span className="act-name">{row.qlooName??row.inputName}</span>{row.qlooName&&row.qlooName!==row.inputName&&<small>Entered as {row.inputName}</small>}{brief.ranking.recommendedRowIds.includes(row.rowId)&&<span className="shortlist-flag">Shortlist</span>}{row.status==='not_in_qloo'&&<small>Not found in Qloo</small>}{row.status==='skipped'&&<small>You skipped this act</small>}</th>
      <td><Affinity value={row.affinity} outOfRange={row.outOfRange} receiptId={row.affinityReceiptId} receipts={brief.receipts} onReceipt={onReceipt}/></td>
      <td className="numeric">{money(row.feeAmount,brief.request.budget.currency)}</td><td><span className={`availability ${row.bookability}`}>{row.bookability}</span></td><td>{row.withinBudget===false?<span className="warning-label">Over budget</span>:row.withinBudget===true?'Within budget':'Unknown'}</td>
    </tr>)}</tbody></table></div>
    {!brief.ranking.recommendedRowIds.length&&<p className="empty-state">No eligible scored acts were shortlisted. Unscored acts remain visible above.</p>}
  </section>;
}
function Partners({run,brief,onReceipt}:{run:Run;brief:Brief;onReceipt:(id:string)=>void}) {
  return <section aria-labelledby="partners-title"><div className="result-section-heading"><div><p className="eyebrow">Beyond the bill</p><h3 id="partners-title">Co-promotion shortlist</h3></div><p className="muted">Taste affinity, with scope made explicit.</p></div><div className="partner-columns">{brief.request.partnerCategories.map(category=>{
    const shortlist=brief.partners.find(p=>p.category===category);
    const error=run.steps.find(s=>s.tool==='find_partners'&&s.args?.category===category&&s.status==='error')?.error;
    return <section className="paper partner-category" aria-label={`${categoryName[category]} shortlist`} key={category}><header><span className="eyebrow">{category==='place'?'Venue area':'Global taste'}</span><h4>{categoryName[category]}</h4></header>
      {!shortlist?<p className="empty-state">No successful shortlist was recorded.{error&&<> Error: <code>{error.code}</code>.</>} See the agent activity for details.</p>:<>
        <p className="scope-note">{shortlist.scopeNote}</p><small>Planner: {shortlist.planner} · Scope: {shortlist.scope.replaceAll('_',' ')}</small>
        {shortlist.tagFilter.length>0&&<div className="tag-filters"><span>Filtered by</span>{shortlist.tagFilter.map(tag=><div key={tag.id}><span>{tag.name}</span> <ReceiptChip id={tag.receiptId} receipt={brief.receipts.find(r=>r.id===tag.receiptId)} ready onOpen={onReceipt}/></div>)}</div>}
        {shortlist.items.length===0?<p className="empty-state">No partners returned for this request.</p>:<ol className="partner-list">{shortlist.items.map(item=><li key={item.entityId}><h5>{item.name}</h5><Affinity value={item.affinity} outOfRange={item.affinity!==null&&(item.affinity<0||item.affinity>1)} receiptId={item.affinityReceiptId} receipts={brief.receipts} onReceipt={onReceipt}/>{category==='place'&&<p className="derived-distance">{item.distanceM===null?'Distance unknown':`${item.distanceM.toLocaleString('en')} m · calculated from coordinates`}</p>}{item.address&&<small>{item.address}</small>}{item.tags.length>0&&<div className="tags">{item.tags.map(tag=><span key={tag.id}>{tag.name}</span>)}</div>}</li>)}</ol>}
        {shortlist.uncertainty.length>0&&<div className="partner-notes"><strong>Scope observations</strong>{shortlist.uncertainty.map((note,i)=><p key={i}>{note}</p>)}</div>}
      </>}
    </section>;
  })}</div></section>;
}
function Claims({brief,onReceipt}:{brief:Brief;onReceipt:(id:string)=>void}) {
  return <article className="paper booking-brief" aria-labelledby="brief-title"><div className="brief-masthead"><div><p className="eyebrow">Booking desk / one-page brief</p><h3 id="brief-title">{brief.ranking.headliner.name}</h3><p>{brief.request.venue.name} · {brief.request.venue.city}{brief.request.showDate?` · ${brief.request.showDate}`:''}</p></div><span className="document-mark" aria-hidden="true">OF<br/>01</span></div>
    {(['openers','partners','caveats'] as const).map(section=><section className="claim-group" key={section}><h4>{section[0].toUpperCase()+section.slice(1)}</h4>{brief.claims.filter(c=>c.section===section).length===0?<p className="muted">No accepted claims in this section.</p>:brief.claims.filter(c=>c.section===section).map(claim=><div className="claim" key={claim.id}><p>{claim.text}</p><div className="claim-refs">{claim.refs.map((ref,i)=>ref.kind==='receipt'?<ReceiptChip key={`${ref.receiptId}-${i}`} id={ref.receiptId} receipt={brief.receipts.find(r=>r.id===ref.receiptId)} ready onOpen={onReceipt}/>:<span key={i} className="input-ref">Your {ref.field.replaceAll('_',' ')} input{ref.rowId?` · ${brief.request.roster.find(r=>r.rowId===ref.rowId)?.name??ref.rowId}`:''}</span>)}</div></div>)}</section>)}
    <section className="system-notes"><h4>{COPY.applicationObservations}</h4>{brief.systemNotes.length?<ul>{brief.systemNotes.map((note,i)=><li key={i}>{note}</li>)}</ul>:<p>No additional application observations.</p>}<p className="muted">These are deterministic application notes, separate from evidence-backed claims.</p></section>
    {brief.droppedClaims.length>0&&<details className="rejected-claims"><summary>Claims removed by the receipt check</summary>{brief.droppedClaims.map(({claim,check})=><div key={claim.id}><p>{claim.text}</p><ul>{check.violations.map((violation,i)=><li key={i}><code>{violation.rule}</code>: {violation.detail}</li>)}</ul></div>)}</details>}
    <footer className="brief-disclaimer">{brief.disclaimer}</footer>
  </article>;
}
export function Comparison({baseline,diff,fixture}:{baseline:BaselineResult|null;diff:BaselineDiff|null;fixture:boolean}) {
  const [open,setOpen]=useState(false);
  return <section className="paper comparison"><button className="comparison-toggle" type="button" role="switch" aria-checked={open} aria-controls="baseline-panel" onClick={()=>setOpen(!open)}><span><span className="eyebrow">Same inputs, no Qloo tools</span><strong>Compare with LLM-only</strong></span><span className={`switch ${open?'on':''}`} aria-hidden="true"><span/></span></button>
    {open&&<div id="baseline-panel" className="comparison-content"><h3>{fixture||baseline?.source==='fixture'?COPY.fixtureComparison:'Ranking comparison with LLM-only'}</h3>
      {baseline&&<BaselineProvenance baseline={baseline}/>}
      {!baseline?<p className="empty-state">The comparison was not requested for this run.</p>:baseline.status!=='ok'||!baseline.output?<p className="empty-state">{baseline.status==='unavailable'?COPY.baselineNone:baseline.status==='invalid_output'?COPY.baselineInvalid:'The baseline could not be completed.'}{baseline.error&&<> <code>{baseline.error.code}</code></>}</p>:<>
        {diff&&<>
          <p className="comparison-summary">{diff.changedPositions} of {diff.rows.filter(r=>r.baselinePos!==null&&r.qlooRank!==null).length} jointly ranked opener positions differ · {Object.values(diff.partners).reduce((n,p)=>n+p.noReceipt.length,0)} baseline partner picks have no Qloo receipt · {diff.baselineCopyViolations.length} baseline {diff.baselineCopyViolations.length===1?'sentence breaks':'sentences break'} the copy rules</p>
          <p className="muted">{fixture||baseline.source==='fixture'?'Illustrative hand-written fixture differences; no model or Qloo performance was measured.':'This comparison describes differences for this run, without a claim of superiority.'}</p>
          <p className="tau">Kendall tau-b: {diff.kendallTau===null?'Insufficient shared rankings':String(diff.kendallTau)}</p>
          <div className="table-scroll" role="region" aria-label="Baseline ranking comparison" tabIndex={0}><table><thead><tr><th scope="col">Act</th><th scope="col">Baseline position</th><th scope="col">Qloo affinity rank</th><th scope="col">Change</th></tr></thead><tbody>{diff.rows.map(row=><tr key={row.rowId}><th scope="row">{row.name}</th><td>{row.baselinePos??'Not ranked'}</td><td>{row.qlooRank??'No affinity'}</td><td>{row.delta===null?'—':row.delta>0?`+${row.delta}`:row.delta}</td></tr>)}</tbody></table></div>
          {diff.baselineNotInRoster.length>0&&<p><strong>Baseline picks outside your roster:</strong> {diff.baselineNotInRoster.join(', ')}</p>}
          <div className="baseline-partners">{(['brand','place','podcast'] as const).map(category=><div key={category}><h4>{categoryName[category]}</h4><p>Matches returned shortlist: {diff.partners[category].matchedQloo.join(', ')||'None'}</p><p>No Qloo receipt: {diff.partners[category].noReceipt.join(', ')||'None'}</p></div>)}</div>
          {diff.baselineCopyViolations.length>0&&<div className="baseline-violations"><h4>Baseline copy-rule flags</h4>{diff.baselineCopyViolations.map((v,i)=><p key={i}><code>{v.lexiconId}</code> <q>{v.text}</q></p>)}</div>}
        </>}
        <details><summary>Unverified baseline rationale</summary><p className="muted">This is baseline output, separate from the accepted booking brief.</p><ul>{baseline.output.rationale.map((sentence,i)=><li key={i}>{sentence}</li>)}</ul></details>
      </>}
    </div>}
  </section>;
}
function Parameters({brief}:{brief:Brief}) {
  const calls=[...new Map(brief.receipts.map(r=>[r.callId,r])).values()];
  return <details className="paper parameter-panel"><summary>Request and evidence details</summary><p>Request parameters are validated against the documented schema before calls are sent. This does not prove that upstream filters were enforced.</p><p><strong>Live contrast probes: unverified.</strong> No live probe report is attached to this brief.</p>{calls.map(call=><div className="request-record" key={call.callId}><strong>{call.endpoint}</strong> <code>{call.callId}</code><pre>{call.params.map(([key,value])=>`${key} = ${value}`).join('\n')}</pre></div>)}</details>;
}
export function Results({run,fixture,onReceipt}:{run:Run;fixture:boolean;onReceipt:(id:string)=>void}) {
  const brief=run.brief;if(!brief)return null;
  return <div className="results">
    <div className="result-summary"><div><span className="summary-number">{brief.ranking.recommendedRowIds.length.toString().padStart(2,'0')}</span><span>eligible acts shortlisted</span></div><div><span className="summary-number">{brief.partners.reduce((n,p)=>n+p.items.length,0).toString().padStart(2,'0')}</span><span>partner suggestions returned</span></div><div><span className="summary-number">{brief.receipts.length}</span><span>receipts in this brief</span></div></div>
    <Ranking brief={brief} onReceipt={onReceipt}/><Partners run={run} brief={brief} onReceipt={onReceipt}/>
    <div className="brief-layout"><Claims brief={brief} onReceipt={onReceipt}/><aside className="brief-sidebar"><WriterProvenance writer={brief.writer}/><div className="export-card"><p className="eyebrow">Take it to the booking desk</p><h3>Keep your working</h3><a className="primary button-link" href={api.export(run.id,'html')} target="_blank" rel="noreferrer">Open printable brief ↗</a><a className="button-link" href={api.export(run.id,'md')} download={`openerfit-brief.md`}>Export Markdown ↓</a><small>Both exports include claims, provenance, policy and a receipt appendix.</small></div></aside></div>
    <Comparison baseline={run.baseline} diff={run.diff} fixture={fixture}/><Parameters brief={brief}/>
  </div>;
}
