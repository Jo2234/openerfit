import { expect,it } from 'vitest';
import { classifyProbe,probeDefinitions,UNCERTAIN_NOTE } from '../../src/qloo/probe';
const a={ids:['fx-a'],status:200},b={ids:['fx-b'],status:200};
it('Q9: all evidence branches including observational differences and empty outputs',()=>{
 expect(classifyProbe(a,a).outcome).toBe('uncertain');expect(classifyProbe(a,a).note).toBe(UNCERTAIN_NOTE);
 expect(classifyProbe(a,a,true).outcome).toBe('consistent');expect(classifyProbe(a,b,false).outcome).toBe('predicate_violated');expect(classifyProbe(a,b,true).outcome).toBe('effect_observed');
 expect(classifyProbe(a,b)).toMatchObject({outcome:'effect_observed',observationalOnly:true});expect(classifyProbe(a,{ids:[],status:200},true).outcome).toBe('uncertain');expect(classifyProbe(a,{ids:[],status:400}).outcome).toBe('error');
});
it('v1.1 P2 and P3 have no hard enforcement predicate',()=>{const defs=probeDefinitions({headlinerA:'fx-a',headlinerB:'fx-b',rosterIds:['fx-c'],excludeBrandId:'fx-d',tagId:'urn:tag:fixture:x'});expect(defs.find(p=>p.id==='P2')?.predicate).toBe('observational');expect(defs.find(p=>p.id==='P3')?.predicate).toBe('advisory_location');});
it('Q9 property: outcome tokens never claim ignored parameters',async()=>{
 const fc=await import('fast-check');fc.assert(fc.property(fc.array(fc.string(),{maxLength:5}),fc.array(fc.string(),{maxLength:5}),fc.option(fc.boolean(),{nil:null}),(a,b,predicate)=>{const result=classifyProbe({ids:a,status:200},{ids:b,status:200},predicate);expect(result.outcome).not.toContain('ignored');if(result.note.includes('ignored'))expect(result.note).toContain(UNCERTAIN_NOTE);}),{numRuns:100});
});
