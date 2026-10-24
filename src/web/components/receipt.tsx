import { useEffect, useRef, useState } from 'react';
import type { Receipt } from '../../shared/types';
import { api, errorCopy } from '../api';
export function ReceiptChip({id,receipt,ready,onOpen}:{id:string;receipt?:Receipt;ready:boolean;onOpen:(id:string)=>void}) {
  return <button type="button" className="receipt-chip" disabled={!ready} title={!ready?'Receipt inspection is available when the brief completes.':undefined}
    aria-label={`Receipt ${id}: ${ready&&receipt?`${receipt.endpoint} value ${receipt.rawValueText}`:'pending until brief completes'}`} onClick={()=>onOpen(id)}>{id}<span aria-hidden="true"> ↗</span></button>;
}
export function ReceiptDrawer({runId,id,returnFocus,onClose}:{runId:string;id:string;returnFocus?:HTMLElement|null;onClose:()=>void}) {
  const [data,setData]=useState<Awaited<ReturnType<typeof api.receipt>>|null>(null),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const panel=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const trigger=returnFocus??(document.activeElement instanceof HTMLElement?document.activeElement:null);
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();
    return()=>{document.body.style.overflow=previous;trigger?.focus();};
  },[]);
  useEffect(()=>{const controller=new AbortController();setData(null);setError(null);api.receipt(runId,id,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(errorCopy(e));});return()=>controller.abort();},[runId,id,retry]);
  return <div className="drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div ref={panel} className="receipt-drawer" role="dialog" aria-modal="true" aria-labelledby="receipt-title" onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();onClose();}
      if(e.key==='Tab'){
        const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');if(!nodes?.length)return;
        const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    }}>
      <header className="drawer-heading"><div><p className="eyebrow">Evidence record</p><h2 id="receipt-title">Exact receipt</h2><code>{id}</code></div><button ref={close} className="icon-button" onClick={onClose} aria-label="Close receipt">×</button></header>
      {!data&&!error&&<p role="status">Loading receipt…</p>}
      {error&&<div role="alert" className="error-box"><p>{error}</p><button onClick={()=>{setRetry(v=>v+1);close.current?.focus();}}>Retry receipt</button></div>}
      {data&&<>
        <div className="receipt-value"><span className="eyebrow">Exact returned value</span><pre data-testid="raw-receipt-value">{data.receipt.rawValueText}</pre></div>
        <dl className="receipt-fields">
          <dt>Endpoint</dt><dd><code>{data.receipt.endpoint}</code></dd>
          <dt>Value path</dt><dd><code>{data.receipt.valuePath}</code></dd>
          <dt>Entity</dt><dd>{data.receipt.entity?.name??'No containing entity'}<br/><code>{data.receipt.entity?.id??'—'}</code></dd>
          <dt>Call ID</dt><dd><code>{data.receipt.callId}</code></dd>
          <dt>Origin</dt><dd>{data.receipt.origin}</dd>
          <dt>Fixture label</dt><dd>{data.receipt.fixtureLabel??'None'}</dd>
          <dt>Requested</dt><dd>{data.receipt.requestedAt}</dd>
          <dt>Original live fetch</dt><dd>{data.receipt.liveFetchedAt??(data.receipt.origin==='live-cache'?'Time unavailable':'Not a live fetch')}</dd>
        </dl>
        <h3>Request parameters</h3><div className="parameter-list">{data.receipt.params.map(([key,value])=><div key={key}><code>{key}</code><pre>{value}</pre></div>)}</div>
        <h3>Entity excerpt</h3>{data.entityExcerpt===null?<p className="muted">No raw entity excerpt is available. The exact receipt above is complete.</p>:<pre className="code-block">{JSON.stringify(data.entityExcerpt,null,2)}</pre>}
      </>}
    </div>
  </div>;
}
