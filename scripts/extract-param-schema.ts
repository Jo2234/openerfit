import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export interface ParamDefinition { tier: 'guide' | 'reference_only'; required: boolean; schema: Record<string, unknown> }
export interface ParamSchema { insights: Record<string, Record<string, ParamDefinition>>; search: Record<string, ParamDefinition>; tags: Record<string, ParamDefinition>; sources: {file: string; sha256: string; upstreamUrls?: string[]}[] }
interface ParameterFact extends ParamDefinition { endpoint: 'insights'|'search'|'tags'; entityType?: string; name: string }
export async function extractParamSchema(root = process.cwd()): Promise<ParamSchema> {
  const file = 'fixtures/param-schema/definitions.json';
  const text = await readFile(path.join(root, file), 'utf8');
  const input = JSON.parse(text) as {formatVersion: number; upstreamUrls: string[]; parameters: ParameterFact[]};
  if (input.formatVersion !== 1) throw new Error('Unsupported parameter inventory format');
  const result: ParamSchema = {insights: {}, search: {}, tags: {}, sources: [{file, sha256: createHash('sha256').update(text).digest('hex'), upstreamUrls: input.upstreamUrls}]};
  for (const {endpoint, entityType, name, tier, required, schema} of input.parameters) {
    if (!['insights','search','tags'].includes(endpoint) || !['guide','reference_only'].includes(tier) || typeof required !== 'boolean') throw new Error('Invalid parameter fact');
    if (endpoint === 'insights' && !entityType) throw new Error('Insight parameter needs an entity type');
    const target = endpoint === 'insights' ? (result.insights[entityType!] ??= {}) : result[endpoint];
    if (Object.hasOwn(target, name)) throw new Error('Duplicate parameter fact');
    target[name] = {tier, required, schema};
  }
  return result;
}
export const serializeParamSchema = (schema: ParamSchema) => JSON.stringify(schema, null, 2) + '\n';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writeFile('src/qloo/param-schema.generated.json', serializeParamSchema(await extractParamSchema()));
