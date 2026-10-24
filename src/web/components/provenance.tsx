import type { BaselineResult, Brief, WriterInfo } from '../../shared/types';
import { COPY } from '../../shared/copy';
import type { Health } from '../api';
export function ModeBar({health,brief}:{health:Health|null;brief:Brief|null}) {
  const fixture=health?.qloo.mode==='fixture'||brief?.origins.includes('fixture');
  const cached=brief?.origins.includes('live-cache');
  const fetched=brief?.receipts.filter(r=>r.origin==='live-cache').map(r=>r.liveFetchedAt).find(Boolean);
  return <div className="mode-stack">
    {fixture&&<p className="fixture-banner"><span aria-hidden="true">◉</span>{COPY.fixtureBanner}</p>}
    <div className="mode-bar"><span><span className={`status-dot ${fixture?'fixture':''}`} aria-hidden="true"/>{health?`Qloo: ${health.qloo.mode==='fixture'?'synthetic fixture':'live'}`:'Checking data mode…'}</span><span>Writer mode: {health?.llm.mode==='fixture'?'hand-written fixture':health?.llm.mode==='openai-compatible'?health.llm.model??'model':health?'template (no LLM)':'checking…'}</span></div>
    {cached&&<p className="cache-note">Some results came from this server’s private live cache. Original fetch: {fetched??'time unavailable'}.</p>}
  </div>;
}
export function WriterProvenance({writer}:{writer:WriterInfo}) {
  return <div className="provenance-block" aria-label="Brief selector provenance"><strong>{writer.kind==='template'?'Deterministic template':'Catalogue selection'}</strong>
    <p>{writer.source==='fixture'?'Selection source: hand-written fixture, not a model output.':writer.source==='llm'?'Selection source: completed model output.':'Selection source: no completed model output.'}</p>
    {writer.fixtureLabel&&<p>{writer.fixtureLabel}</p>}
    {writer.model&&<p>{writer.source===null?'Attempted model':'Model'}: <code>{writer.model}</code></p>}
    {writer.promptVersion&&<p>Prompt: <code>{writer.promptVersion}</code> · Attempts: {writer.attempts}</p>}
    {writer.fallbackReason&&<p>Template fallback: <code>{writer.fallbackReason}</code></p>}
    <small>Factual text comes from the server’s validated claim catalogue. A selector can choose and order facts.</small>
  </div>;
}
export function BaselineProvenance({baseline}:{baseline:BaselineResult}) {
  return <div className="provenance-block" aria-label="Baseline provenance">
    {baseline.source==='fixture'?<p className="fixture-note">{COPY.baselineFixture}</p>:<p>{baseline.source==='llm'?'Baseline source: model output without Qloo tools.':'Baseline source: no completed output.'}</p>}
    {baseline.fixtureLabel&&<p>{baseline.fixtureLabel}</p>}{baseline.model&&<p>Model: <code>{baseline.model}</code></p>}
    {baseline.promptVersion&&<p>Prompt: <code>{baseline.promptVersion}</code></p>}
  </div>;
}
