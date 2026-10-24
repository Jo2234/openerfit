import path from 'node:path';
import { z } from 'zod';
export interface QlooEnv { mode: 'fixture'|'live'; apiKey: string | null; baseUrl: string; cacheDir: string; cacheTtlMs: number; cacheEnabled: boolean; fixtureDir: string }
export interface AppEnv {
  qloo: QlooEnv; llm: { mode:'none'|'fixture'|'openai-compatible'; apiKey:string|null; baseUrl:string|null; model:string|null; timeoutMs:number; llamaCpp:boolean; supportsSeed:boolean; reasoningEffort: 'none'|'minimal'|'low'|'medium'|'high'|null; plannerMaxTokens:number; writerMaxTokens:number; baselineMaxTokens:number };
  host:string; port:number; trustProxy:boolean; production:boolean;
}
const integer = (raw: string | undefined, fallback: number, min: number, max: number) => { const v = raw === undefined ? fallback : Number(raw); if (!Number.isInteger(v) || v < min || v > max) throw new Error('Invalid numeric configuration (value not printed)'); return v; };
const bool = (v: string | undefined, name: string) => { if (v !== undefined && v !== '0' && v !== '1') throw new Error(`${name} must be 0 or 1 (value not printed)`); return v === '1'; };
export function validateQlooBaseUrl(raw: string): string {
  let u: URL; try { u = new URL(raw); } catch { throw new Error('Invalid QLOO_BASE_URL (value not printed)'); }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.origin === 'https://hackathon.api.qloo.com' || u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error('QLOO_BASE_URL must be the hackathon host or an HTTP loopback stub (value not printed)');
  return u.origin;
}
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const mode = z.enum(['fixture','live']).parse(source.QLOO_MODE ?? 'fixture');
  const apiKey = source.QLOO_API_KEY?.trim() || null;
  if (mode === 'live' && !apiKey) throw new Error('QLOO_MODE=live requires QLOO_API_KEY (value not printed)');
  const llmMode = z.enum(['none','fixture','openai-compatible']).parse(source.LLM_MODE ?? 'none');
  if (llmMode === 'openai-compatible' && (!source.LLM_MODEL || !source.LLM_BASE_URL)) throw new Error('LLM_MODE=openai-compatible requires LLM_MODEL and LLM_BASE_URL (values not printed)');
  let llmUrl: string | null = null;
  if (source.LLM_BASE_URL) { try { const u = new URL(source.LLM_BASE_URL); if (!['http:','https:'].includes(u.protocol)) throw new Error(); llmUrl = u.toString(); } catch { throw new Error('Invalid LLM_BASE_URL (value not printed)'); } }
  const reasoningEffort = source.LLM_REASONING_EFFORT;
  if (reasoningEffort !== undefined && !['none','minimal','low','medium','high'].includes(reasoningEffort)) throw new Error('Invalid LLM_REASONING_EFFORT (value not printed)');
  if (source.QLOO_CACHE !== undefined && !['on','off'].includes(source.QLOO_CACHE)) throw new Error('QLOO_CACHE must be on or off');
  return {qloo:{mode,apiKey,baseUrl:validateQlooBaseUrl(source.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com'), cacheDir:path.resolve(source.QLOO_CACHE_DIR ?? '.cache/qloo'),cacheTtlMs:integer(source.QLOO_CACHE_TTL_HOURS,168,0,87600)*3600000,cacheEnabled:source.QLOO_CACHE !== 'off',fixtureDir:path.resolve('fixtures/qloo')},llm:{mode:llmMode,apiKey:source.LLM_API_KEY || null,baseUrl:llmUrl,model:source.LLM_MODEL || null,timeoutMs:integer(source.LLM_TIMEOUT_MS,180000,1,600000),llamaCpp:bool(source.LLM_LLAMACPP,'LLM_LLAMACPP'),supportsSeed:bool(source.LLM_SUPPORTS_SEED ?? '1','LLM_SUPPORTS_SEED'),reasoningEffort:reasoningEffort as AppEnv['llm']['reasoningEffort'] ?? null,plannerMaxTokens:integer(source.LLM_PLANNER_MAX_TOKENS,300,64,16384),writerMaxTokens:integer(source.LLM_WRITER_MAX_TOKENS,1200,64,16384),baselineMaxTokens:integer(source.LLM_BASELINE_MAX_TOKENS,900,64,16384)},host:source.HOST ?? '127.0.0.1',port:integer(source.PORT,5188,1,65535),trustProxy:bool(source.TRUST_PROXY,'TRUST_PROXY'),production:source.NODE_ENV === 'production'};
}
export const safeUrlHost = (raw: string | null): string | null => raw ? new URL(raw).host : null;
