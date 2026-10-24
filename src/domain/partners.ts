import type { PartnerCategory, PartnerShortlist, QlooCallRecord, Receipt, VenueInput } from '../shared/types';
import { COPY } from '../shared/copy';
import { affinityReceipt, finite, object, recordedEntities } from './receipts';
export function validCoordinates(lat:unknown,lon:unknown):boolean {return finite(lat)&&finite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
/** Derived metres, R=6,371,008.8; null for missing/invalid coordinates. Not returned evidence. */
export function haversineM(lat1:unknown,lon1:unknown,lat2:unknown,lon2:unknown):number|null {
  if(!validCoordinates(lat1,lon1)||!validCoordinates(lat2,lon2))return null;
  const rad=(n:number)=>n*Math.PI/180;const a=rad((lat2 as number)-(lat1 as number));const b=rad((lon2 as number)-(lon1 as number));
  const h=Math.sin(a/2)**2+Math.cos(rad(lat1 as number))*Math.cos(rad(lat2 as number))*Math.sin(b/2)**2;
  return Math.round(6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h))));
}
export interface ShortlistEvidence { shortlist:PartnerShortlist;receipts:Receipt[] }
const numericToken='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const pointPattern=new RegExp(`^POINT\\(\\s*(${numericToken})\\s+(${numericToken})\\s*\\)$`);
const numberPattern=new RegExp(`^${numericToken}$`);
/** Labels describe the recorded request, independently of returned geometry or result count. */
function validateRecordedFilters(call:QlooCallRecord,category:PartnerCategory,venue:VenueInput,tagFilter:PartnerShortlist['tagFilter']):void {
  const keys=['filter.location','filter.location.radius','filter.geocode.name','filter.location.query','filter.tags'];
  const params=new Map<string,string>();
  for(const [key,value] of call.params)if(keys.includes(key)){
    if(params.has(key))throw new Error('Partner record has duplicate scope/tag parameters');
    params.set(key,value);
  }
  const scopeError=()=>{throw new Error('Partner record scope mismatch');};
  const location=params.get('filter.location'),radius=params.get('filter.location.radius'),city=params.get('filter.geocode.name');
  if(params.has('filter.location.query'))scopeError();
  if(category!=='place'){
    if(location!==undefined||radius!==undefined||city!==undefined)scopeError();
  }else if(validCoordinates(venue.lat,venue.lon)){
    const point=location===undefined?null:pointPattern.exec(location);
    const recordedLon=point?Number(point[1]):NaN,recordedLat=point?Number(point[2]):NaN;
    const recordedRadius=radius!==undefined&&numberPattern.test(radius.trim())?Number(radius):NaN;
    if(city!==undefined||!validCoordinates(recordedLat,recordedLon)||recordedLat!==venue.lat||recordedLon!==venue.lon||!Number.isInteger(venue.radiusM)||venue.radiusM<100||venue.radiusM>50000||recordedRadius!==venue.radiusM)scopeError();
  }else if(location!==undefined||radius!==undefined||city===undefined||city!==venue.city||!city.trim())scopeError();
  const rawTags=params.get('filter.tags');const recordedIds=rawTags===undefined?[]:rawTags.split(',');
  const selectedIds=tagFilter.map(tag=>tag.id);const recorded=new Set(recordedIds),selected=new Set(selectedIds);
  if(recordedIds.some(id=>!id)||selectedIds.some(id=>!id)||recorded.size!==selected.size||[...recorded].some(id=>!selected.has(id)))throw new Error('Partner record tag filter mismatch');
}

/** Exclusions include call signal/exclude IDs plus explicit roster IDs supplied by S3. */
export function buildShortlistEvidence(call:QlooCallRecord,category:PartnerCategory,venue:VenueInput,tagFilter:PartnerShortlist['tagFilter'],planner:PartnerShortlist['planner'],excludedIds:readonly string[]=[]):ShortlistEvidence {
  if(call.endpoint!=='/v2/insights'||!call.params.some(([k,v])=>k==='filter.type'&&v===`urn:entity:${category}`))throw new Error('Partner record category mismatch');
  validateRecordedFilters(call,category,venue,tagFilter);
  const excluded=new Set([...excludedIds,...call.params.filter(([k])=>['signal.interests.entities','filter.exclude.entities'].includes(k)).flatMap(([,v])=>v.split(','))]);
  const point=validCoordinates(venue.lat,venue.lon);const scope=category!=='place'?'global_taste':point?'near_venue_point':'city_name_match';
  const scopeNote=scope==='global_taste'?COPY.globalScope:scope==='near_venue_point'?COPY.pointScope(venue.radiusM):COPY.cityScope(venue.city);
  const uncertainty:string[]=[];const receipts:Receipt[]=[];const seen=new Set<string>();let duplicate=false;const rows=recordedEntities(call);
  const items=rows.flatMap(row=>{
    if(excluded.has(row.identity.id))return [];if(seen.has(row.identity.id)){duplicate=true;return [];}seen.add(row.identity.id);
    const receipt=affinityReceipt(call,row);const properties=object(row.value.properties);const location=object(row.value.location);const geo=object(properties?.geocode);
    const coords=validCoordinates(location?.lat,location?.lon)?[location!.lat,location!.lon]:validCoordinates(geo?.latitude,geo?.longitude)?[geo!.latitude,geo!.longitude]:[row.value.lat,row.value.lon];
    const distanceM=category==='place'?haversineM(venue.lat,venue.lon,coords[0],coords[1]):null;
    const tags=(Array.isArray(row.value.tags)?row.value.tags:[]).flatMap(t=>{const v=object(t);const id=v?.id??v?.tag_id;return typeof id==='string'&&typeof v?.name==='string'?[{id,name:v.name}]:[];}).slice(0,5);
    return [{entityId:row.identity.id,name:row.identity.name,category,affinity:receipt?.value as number??null,affinityReceiptId:receipt?.id??null,qlooOrder:row.index,address:typeof properties?.address==='string'?properties.address:typeof row.value.address==='string'?row.value.address:null,distanceM,tags,receipt}];
  }).slice(0,8).map(({receipt,...item})=>{if(receipt)receipts.push(receipt);return item;});
  if(!rows.length)uncertainty.push(COPY.emptyInsights);if(duplicate)uncertainty.push('duplicate result IDs');
  const far=items.filter(item=>item.distanceM!==null&&item.distanceM>venue.radiusM*1.5).length;
  if(far)uncertainty.push(`${far} place(s) are farther than the requested radius`);
  return {shortlist:{category,scope,scopeNote,tagFilter:tagFilter.map(t=>({...t})),items,callId:call.callId,planner,uncertainty},receipts};
}
export function buildShortlist(call:QlooCallRecord,category:PartnerCategory,venue:VenueInput,tagFilter:PartnerShortlist['tagFilter'],planner:PartnerShortlist['planner'],excludedIds:readonly string[]=[]):PartnerShortlist {return buildShortlistEvidence(call,category,venue,tagFilter,planner,excludedIds).shortlist;}
