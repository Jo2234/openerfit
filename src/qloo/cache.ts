import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { sha256 } from './record';
export interface CacheEntry { liveFetchedAt:string; status:number; bodyText:string }
export class QlooCache {
  readonly namespace: string;
  constructor(private dir: string, baseUrl: string, apiKey: string, private ttlMs: number, private now = Date.now) {
    this.namespace = createHmac('sha256', apiKey).update(`openerfit-qloo-v1\n${baseUrl}`).digest('hex');
  }
  private file(canonicalUrl: string) { return path.join(this.dir, this.namespace, sha256(canonicalUrl)+'.json'); }
  async get(canonicalUrl: string): Promise<CacheEntry|null> {
    try { const text = await readFile(this.file(canonicalUrl),'utf8'); if (Buffer.byteLength(text)>5_000_000) return null;
      const entry = JSON.parse(text) as CacheEntry; const age = this.now()-Date.parse(entry.liveFetchedAt);
      if (entry.status !== 200 || typeof entry.bodyText !== 'string' || Buffer.byteLength(entry.bodyText)>2_000_000 || !Number.isFinite(age) || age < 0 || age >= this.ttlMs) return null;
      return entry;
    } catch { return null; }
  }
  async put(canonicalUrl: string, entry: CacheEntry) {
    const file=this.file(canonicalUrl), dir=path.dirname(file); const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
    await mkdir(this.dir,{recursive:true,mode:0o700}); await chmod(this.dir,0o700); await mkdir(dir,{recursive:true,mode:0o700}); await chmod(dir,0o700);
    await writeFile(temporary,JSON.stringify(entry),{mode:0o600}); await rename(temporary,file);
  }
}
