import { readFile,readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { expect,it,vi } from 'vitest';
import { FixtureQlooClient } from '../../src/qloo/fixture-client';
import scenarios from '../../fixtures/scenarios.json';
it('Q6: exact synthetic fixture, no network or cache, explicit missing coverage',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch');const client=new FixtureQlooClient();
 const call=await client.search({query:'Harbour Lights',types:['urn:entity:artist'],take:5});expect(call.origin).toBe('fixture');expect(call.fixtureLabel).toContain('synthetic');expect(call.durationMs).toBe(0);
 await expect(client.search({query:'Harbour Lightz',types:['urn:entity:artist'],take:5})).rejects.toMatchObject({code:'fixture_missing'});
 const rank=await client.insights({type:'urn:entity:artist',interestEntityIds:['fx-art-hl'],resultEntityIds:scenarios[0].confirmedRosterIds,take:7});expect((rank.body as any).results.entities[0].query.affinity).toBe(.9127);
 const empty=await client.insights({type:'urn:entity:artist',interestEntityIds:['fx-edge-empty'],resultEntityIds:['fx-edge-a','fx-edge-b','fx-edge-c','fx-edge-d','fx-edge-e','fx-edge-f'],take:6});expect((empty.body as any).results.entities).toEqual([]);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
});
it('Q11: fixture entities/tags are synthetic; Git contains no live data directories',async()=>{
 const inspect=(v:any)=>{if(Array.isArray(v))v.forEach(inspect);else if(v&&typeof v==='object'){for(const [key,value]of Object.entries(v)){if(key==='entity_id')expect(value).toMatch(/^fx-/);if((key==='id'||key==='tag_id')&&typeof value==='string')expect(value).toMatch(/^(fx-|urn:tag:fixture:)/);inspect(value);}}};
 for(const dir of await readdir('fixtures/qloo')){const index=JSON.parse(await readFile(`fixtures/qloo/${dir}/index.json`,'utf8'));expect(index.synthetic).toBe(true);expect(index.label).toContain('synthetic fixture');for(const file of new Set<string>(index.entries.map((e:any)=>e.file)))inspect(JSON.parse(await readFile(`fixtures/qloo/${dir}/${file}`,'utf8')));}
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'});expect(files).not.toMatch(/^(?:\.cache|qloo-cache|recorded)\//m);
});
