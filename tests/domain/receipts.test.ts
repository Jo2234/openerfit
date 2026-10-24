import { expect,test } from 'vitest';
import fc from 'fast-check';
import { ReceiptPathError,receiptFor } from '../../src/domain/receipts';
import { call } from './helpers';
test('D5: 100 independently indexed scalar paths preserve exact values, entity and stable IDs',()=>{
  fc.assert(fc.property(fc.array(fc.oneof(fc.double({noNaN:true,noDefaultInfinity:true}),fc.string(),fc.boolean(),fc.constant(null)),{minLength:1,maxLength:12}),fc.nat(),(values,n)=>{
    const index=n%values.length;const record=call({results:{entities:values.map((v,i)=>({entity_id:`fx-${i}`,name:`Name ${i}`,query:{affinity:v}}))}});
    const path=`results.entities[${index}].query.affinity`;const r=receiptFor(record,path);
    expect(r.value).toEqual(values[index]);expect(r.rawValueText).toBe(JSON.stringify(values[index]));expect(r.entity).toEqual({id:`fx-${index}`,name:`Name ${index}`,subtype:null});expect(receiptFor(record,path).id).toBe(r.id);
    expect(receiptFor(record,`results.entities[${index}].name`).id).not.toBe(r.id);
  }),{numRuns:100,seed:5100});
});
test('D5: nonexistent, inherited, malformed and nonscalar paths cannot mint receipts',()=>{
  const c=call({results:[{id:'fx-a',name:'A',value:null}]});expect(receiptFor(c,'results[0].value').value).toBeNull();
  for(const path of ['results[1].name','results[0].absent','results[0].__proto__','results[0].constructor','results[0]','results[00].name','results[-1].name'])expect(()=>receiptFor(c,path)).toThrow(ReceiptPathError);
  expect(()=>receiptFor(call({results:{value:Infinity}}),'results.value')).toThrow(ReceiptPathError);
});
