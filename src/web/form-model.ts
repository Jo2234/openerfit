import { z } from 'zod';
import { briefRequestSchema } from '../shared/schemas';
import { normalize } from '../domain/normalize';
import type { BriefRequest, ConfirmedResolutions, ResolveResponse, Resolution, SearchCandidate } from '../shared/types';
export type Draft = Omit<BriefRequest,'venue'> & {venue:Omit<BriefRequest['venue'],'radiusM'> & {radiusM:number|null}};
export type FormErrors = Record<string,string>;
export type Choices = Record<string,string>;
export const SKIP='__skip__';
export const STORAGE_KEY='openerfit.form.v1';
export const blankDraft=():Draft=>({headlinerQuery:'',venue:{name:'',city:'',lat:null,lon:null,radiusM:3000,capacity:null},budget:{perOpenerMax:null,currency:'SGD'},showDate:null,roster:[{rowId:'r1',name:'',feeAmount:null,bookability:'unknown',notes:''}],goal:'',partnerCategories:['brand','place','podcast']});
// Persist an explicitly typed draft only. Capability tokens, run/evidence data and
// unknown keys are rejected, rather than passed through from localStorage.
const text=z.string(), number=z.number().finite().nullable();
const draftSchema:z.ZodType<Draft>=z.strictObject({headlinerQuery:text.max(120),venue:z.strictObject({name:text.max(120),city:text.max(80),lat:number,lon:number,radiusM:number,capacity:number}),budget:z.strictObject({perOpenerMax:number,currency:text.max(3)}),showDate:text.nullable(),roster:z.array(z.strictObject({rowId:text.min(1).max(200),name:text.max(120),feeAmount:number,bookability:z.enum(['available','unavailable','unknown']),notes:text.max(200)})).min(1).max(25),goal:text.max(500),partnerCategories:z.array(z.enum(['brand','place','podcast'])).max(3)});
export function restoreDraft(storage:Pick<Storage,'getItem'>|null):Draft {
  try {const parsed=z.strictObject({version:z.literal(1),form:draftSchema}).safeParse(JSON.parse(storage?.getItem(STORAGE_KEY)??'null'));if(parsed.success)return parsed.data.form;}catch{/* Corrupt, incompatible or inaccessible storage is an empty form. */}
  return blankDraft();
}
export function persistDraft(storage:Pick<Storage,'setItem'>|null,draft:Draft):boolean {
  try {const form=draftSchema.parse(draft);storage?.setItem(STORAGE_KEY,JSON.stringify({version:1,form}));return storage!==null;}catch{return false;}
}
export const identityKey=(draft:Pick<Draft,'headlinerQuery'|'roster'>)=>JSON.stringify({headlinerQuery:draft.headlinerQuery,roster:draft.roster.map(({rowId,name})=>({rowId,name}))});
export function validateDraft(draft:Draft):{request:BriefRequest|null;errors:FormErrors} {
  const checked=briefRequestSchema.safeParse(draft),errors:FormErrors={};
  if(!checked.success)for(const issue of checked.error.issues){
    const key=issue.path.join('.');
    const hints:Record<string,string>={headlinerQuery:'Enter a headliner name (1–120 characters).','venue.name':'Enter a venue name (1–120 characters).','venue.city':'Enter a city (1–80 characters).','venue.radiusM':'Enter a whole-number radius from 100 to 50,000 metres.','venue.capacity':'Use a whole-number capacity from 1 to 100,000, or leave it blank.','venue.lat':'Latitude must be between −90 and 90.','venue.lon':'Longitude must be between −180 and 180.',venue:'Add both coordinates, or leave both blank.','budget.perOpenerMax':'Enter a nonnegative budget, or leave it blank for unknown.','budget.currency':'Use a three-letter currency code, such as SGD.',showDate:'Choose a valid calendar date.',partnerCategories:'Choose at least one distinct partner category.',roster:'Use 1–25 distinct roster rows.',goal:'Keep the booking goal within 500 characters.'};
    errors[key]??=hints[key]??(key.endsWith('.feeAmount')?'Enter a nonnegative fee, or leave it blank for unknown.':issue.message);
  }
  const names=new Set<string>();draft.roster.forEach((row,i)=>{const name=normalize(row.name);if(!name)errors[`roster.${i}.name`]='Enter an artist name.';else if(names.has(name))errors[`roster.${i}.name`]='This act is already in your roster.';names.add(name);});
  if(new Set(draft.roster.map(r=>r.rowId)).size!==draft.roster.length)errors.roster='Roster row IDs must be distinct. Paste or load the roster again.';
  return {request:checked.success&&!Object.keys(errors).length?checked.data:null,errors};
}
export function initialChoices(resolved:ResolveResponse):Choices {
  return Object.fromEntries([resolved.headliner,...resolved.roster].map(r=>[r.target,r.chosen?.entityId??(r.status==='not_found'?SKIP:'')]));
}
export function confirmChoices(resolved:ResolveResponse,choices:Choices):{confirmed:ConfirmedResolutions|null;errors:string[]} {
  const errors:string[]=[],used=new Set<string>();
  const choose=(r:Resolution,headliner=false):SearchCandidate|null=>{
    const value=choices[r.target];
    if(!headliner&&value===SKIP)return null;
    const candidate=r.candidates.find(c=>c.entityId===value);
    if(!candidate){errors.push(headliner?'Choose a headliner match before continuing.':`Choose a match or skip ${r.inputName}.`);return null;}
    if(used.has(candidate.entityId))errors.push(`${r.inputName}: this entity is already selected as the headliner or another opener.`);
    used.add(candidate.entityId);return candidate;
  };
  const head=choose(resolved.headliner,true);
  const roster=resolved.roster.map(r=>{const candidate=choose(r);return {rowId:r.target,entityId:candidate?.entityId??null,name:candidate?.name??null,receiptId:candidate?.receiptId??null,status:candidate?'user_confirmed' as const:r.status==='not_found'?'not_found' as const:'user_skipped' as const};});
  if(!roster.some(r=>r.entityId))errors.push('None of your roster acts is confirmed. Choose at least one opener match.');
  return {confirmed:head&&!errors.length?{headliner:{entityId:head.entityId,name:head.name,receiptId:head.receiptId},roster}:null,errors};
}
export const nextRowNumber=(draft:Draft)=>Math.max(0,...draft.roster.map(r=>Number(/^r(\d+)$/.exec(r.rowId)?.[1]??0)))+1;
