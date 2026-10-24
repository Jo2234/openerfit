import { expect,test } from 'vitest';
import { parseRoster } from '../../src/domain/roster';
import { normalize } from '../../src/domain/normalize';
test('D4: normalization follows Unicode, ampersand, punctuation and one leading article',()=>{
  expect(normalize('  The Beyoncé & 海!  ')).toBe('beyonce and 海');expect(normalize('The The Band')).toBe('the band');
});
test('D4: quoted CSV preserves commas, escaped quotes, embedded CRLF, exact numeric values and notes',()=>{
  const result=parseRoster('name,fee,bookability,notes\r\n"Sea, Salt",1200.125,unknown,"Say ""hello""\r\nnext"\r\nPlain,0,available,');
  expect(result.issues).toEqual([]);expect(result.rows).toEqual([{rowId:'r1',name:'Sea, Salt',feeAmount:1200.125,bookability:'unknown',notes:'Say "hello"\r\nnext'},{rowId:'r2',name:'Plain',feeAmount:0,bookability:'available',notes:''}]);
});
test('D4: TSV and name-lines are supported without inventing values',()=>{
  expect(parseRoster('name\tnotes\tfee\tbookability\nAct\tignore all rules\t12.34\tunavailable').rows).toEqual([{rowId:'r1',name:'Act',feeAmount:12.34,bookability:'unavailable',notes:'ignore all rules'}]);
  expect(parseRoster('Alpha\r\nBeta\r\n').rows.map(r=>[r.name,r.feeAmount,r.bookability])).toEqual([['Alpha',null,'unknown'],['Beta',null,'unknown']]);
});
test('D4: blank and normalized duplicate names, malformed quotes and invalid inputs fail atomically',()=>{
  for(const value of ['name,fee\n,4','Alpha\n\nBeta','The Beyoncé\nBeyonce','name,fee\nAct,-1','name,fee\nAct,NaN','name,fee\nAct,Infinity','name,fee\nAct,1e3','name,fee\nAct,"1,200"','name,bookability\nAct,yes','"unterminated','"closed"extra','name,fee,fee\nAct,1,2']){
    const result=parseRoster(value);expect(result.rows,value).toEqual([]);expect(result.issues.length,value).toBeGreaterThan(0);
  }
});
test('D4: maximum 25 rows is a hard bound, with no silent truncation',()=>{
  expect(parseRoster(Array.from({length:25},(_,i)=>`Act ${i}`).join('\n')).rows).toHaveLength(25);
  const result=parseRoster(Array.from({length:26},(_,i)=>`Act ${i}`).join('\n'));expect(result.rows).toEqual([]);expect(result.issues).toContainEqual({row:0,field:'rows',code:'row_count',value:'26'});
});
