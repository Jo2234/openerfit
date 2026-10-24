import { mkdtemp,readdir,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it } from 'vitest';
import { QlooCache } from '../../src/qloo/cache';
it('Q7/v1.1: cache namespace isolates both credentials and upstream bases without plaintext keys',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'qloo-cache-'));
 try{
  const a=new QlooCache(dir,'https://hackathon.api.qloo.com','SENTINEL-A',10000,()=>1000),b=new QlooCache(dir,'https://hackathon.api.qloo.com','SENTINEL-B',10000,()=>1000),c=new QlooCache(dir,'http://127.0.0.1:10','SENTINEL-A',10000,()=>1000);
  const query='/search?query=x',entry={liveFetchedAt:new Date(1000).toISOString(),status:200,bodyText:'{"results":[]}'};await a.put(query,entry);expect(await a.get(query)).toEqual(entry);expect(await b.get(query)).toBeNull();expect(await c.get(query)).toBeNull();expect(a.namespace).not.toBe(b.namespace);expect(a.namespace).not.toBe(c.namespace);
  const namespaces=await readdir(dir);expect(JSON.stringify(namespaces)).not.toContain('SENTINEL');const files=await readdir(path.join(dir,a.namespace));expect(await readFile(path.join(dir,a.namespace,files[0]),'utf8')).not.toContain('SENTINEL');
 }finally{await rm(dir,{recursive:true,force:true});}
});
