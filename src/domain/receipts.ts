import { createHash } from 'node:crypto';
import type { QlooCallRecord, Receipt } from '../shared/types';
export class ReceiptPathError extends Error {
  constructor(public valuePath: string) { super(`No scalar evidence at recorded path: ${valuePath}`); this.name = 'ReceiptPathError'; }
}
export type JsonObject = Record<string, unknown>;
export const object = (v: unknown): JsonObject | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonObject : null;
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Own-property paths only; bracket indices are nonnegative integers. */
export function valueAt(body: unknown, path: string): unknown {
  if (!/^[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[(?:0|[1-9]\d*)\]))*$/.test(path)) throw new ReceiptPathError(path);
  let value = body;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new ReceiptPathError(path);
    value = (value as JsonObject)[key];
  }
  return value;
}
export function entityIdentity(value: unknown): Receipt['entity'] {
  const v = object(value); if (!v) return null;
  const id = typeof v.entity_id === 'string' ? v.entity_id : typeof v.id === 'string' ? v.id : typeof v.tag_id === 'string' ? v.tag_id : null;
  if (!id || typeof v.name !== 'string' || !v.name.trim()) return null;
  const subtype = typeof v.subtype === 'string' ? v.subtype : Array.isArray(v.types) && typeof v.types[0] === 'string' ? v.types[0] : null;
  return { id, name: v.name, subtype };
}
/** Sole receipt constructor. Value AND containing entity are read from call.body. */
export function receiptFor(call: QlooCallRecord, valuePath: string): Receipt {
  const value = valueAt(call.body, valuePath);
  if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value))) throw new ReceiptPathError(valuePath);
  let parent = valuePath; let entity: Receipt['entity'] = null;
  while (/[.\[]/.test(parent)) {
    parent = parent.replace(/(?:\.[^.\[]+|\[\d+\])$/, '');
    entity = entityIdentity(valueAt(call.body, parent)); if (entity) break;
  }
  return { id: 'R-' + createHash('sha256').update(`${call.callId}\n${valuePath}`).digest('hex').slice(0, 10),
    callId: call.callId, endpoint: call.endpoint, params: call.params.map(([k,v]) => [k,v]), origin: call.origin,
    fixtureLabel: call.fixtureLabel, valuePath, value, rawValueText: JSON.stringify(value), entity,
    liveFetchedAt: call.liveFetchedAt, requestedAt: call.requestedAt };
}
export interface RecordedEntity { value: JsonObject; path: string; index: number; identity: NonNullable<Receipt['entity']> }
/** Both documented search/tag shapes; insights uses results.entities only. */
export function recordedEntities(call: QlooCallRecord): RecordedEntity[] {
  const root = object(call.body); const result = object(root?.results);
  const path = call.endpoint === '/search' ? Array.isArray(root?.results) ? 'results' : 'results.entities'
    : call.endpoint === '/v2/tags' ? Array.isArray(result?.tags) ? 'results.tags' : 'results' : 'results.entities';
  let rows: unknown; try { rows = valueAt(call.body, path); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((v, index) => { const identity = entityIdentity(v); const value = object(v); return identity && value ? [{ identity, value, path: `${path}[${index}]`, index }] : []; });
}
/** Nested finite number first, then flattened finite number; never coerce strings. */
export function affinityReceipt(call: QlooCallRecord, row: RecordedEntity): Receipt | null {
  const nested = object(row.value.query)?.affinity;
  const suffix = finite(nested) ? '.query.affinity' : finite(row.value.affinity) ? '.affinity' : null;
  return suffix ? receiptFor(call, row.path + suffix) : null;
}
/** Evidence-bearing tag observations for S3; no fabricated IDs/names. */
export function tagObservations(call: QlooCallRecord): { tags: {id:string;name:string;receiptId:string}[]; receipts:Receipt[] } {
  if (call.endpoint !== '/v2/tags') throw new Error('Expected tag call');
  const receipts:Receipt[]=[];const seen=new Set<string>();
  const tags=recordedEntities(call).flatMap(row=>{if(seen.has(row.identity.id))return [];seen.add(row.identity.id);
    const field=typeof row.value.id==='string'?'id':'tag_id';const receipt=receiptFor(call,`${row.path}.${field}`);receipts.push(receipt);
    return [{id:row.identity.id,name:row.identity.name,receiptId:receipt.id}];}).slice(0,10);
  return {tags,receipts:receipts.filter(r=>tags.some(t=>t.receiptId===r.id))};
}
