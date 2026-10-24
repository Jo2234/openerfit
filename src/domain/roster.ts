import type { Bookability, RosterEntryInput } from '../shared/types';
import { normalize } from './normalize';
export interface RosterParseIssue { row: number; field: string; code: string; value: string }
export interface RosterParseResult { rows: RosterEntryInput[]; issues: RosterParseIssue[] }
/** Parses CSV/TSV/name-lines. Any error returns no rows, never a partially corrected roster. */
export function parseRoster(text: string): RosterParseResult {
  const issues:RosterParseIssue[]=[];const table:string[][]=[];let row:string[]=[];let cell='';let quoted=false;let closed=false;
  // Detect delimiter only outside quoted cells on the first physical record.
  let scanQuote=false;let delimiter='';
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(scanQuote&&text[i+1]==='"'){i++;continue;}scanQuote=!scanQuote;}if(!scanQuote){if(c==='\t'){delimiter='\t';break;}if(c===',')delimiter=',';if(c==='\n'||c==='\r')break;}}
  const issue=(field:string,code:string,value:string)=>issues.push({row:table.length+1,field,code,value});
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'&&cell===''&&!closed){quoted=true;continue;}
    if(c===delimiter&&delimiter){row.push(cell);cell='';closed=false;continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);table.push(row);row=[];cell='';closed=false;continue;}
    if(closed||c==='"')issue('row','malformed_quote',c);cell+=c;
  }
  if(quoted)issue('row','unclosed_quote',cell);
  if(cell!==''||row.length||closed){row.push(cell);table.push(row);}
  const header=table[0]?.map(s=>s.trim().toLowerCase());const hasHeader=header?.[0]==='name';
  const columns=hasHeader?header!:['name','fee','bookability','notes'];
  if(hasHeader&&(new Set(columns).size!==columns.length||columns.some(c=>!['name','fee','bookability','notes'].includes(c))))issues.push({row:1,field:'header',code:'invalid_header',value:table[0].join(delimiter)});
  const data=hasHeader?table.slice(1):table;const rows:RosterEntryInput[]=[];const names=new Set<string>();
  if(data.length<1||data.length>25)issues.push({row:0,field:'rows',code:'row_count',value:String(data.length)});
  data.forEach((cells,i)=>{
    const number=i+1+(hasHeader?1:0);const get=(key:string)=>cells[columns.indexOf(key)]??'';
    const add=(field:string,code:string,value:string)=>issues.push({row:number,field,code,value});
    if(cells.length>columns.length)add('row','extra_columns',cells.join(delimiter));
    const name=get('name').trim();const key=normalize(name);
    if(!name||!key)add('name','blank_name',get('name'));if(name.length>120)add('name','too_long',name);
    if(names.has(key))add('name','duplicate_roster_name',name);names.add(key);
    const fee=get('fee');let feeAmount:number|null=null;
    if(fee!==''){if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(fee)||!Number.isFinite(Number(fee)))add('fee','invalid_fee',fee);else feeAmount=Number(fee);}
    const availability=get('bookability');const bookability=availability===''?'unknown':availability;
    if(!['available','unavailable','unknown'].includes(bookability))add('bookability','invalid_bookability',availability);
    const notes=get('notes');if(notes.length>200)add('notes','too_long',notes);
    rows.push({rowId:`r${i+1}`,name,feeAmount,bookability:bookability as Bookability,notes});
  });
  return {rows:issues.length?[]:rows,issues};
}
