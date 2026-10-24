import { useEffect, useRef, useState } from 'react';
import { COPY } from '../shared/copy';
import { useBooking } from './use-booking';
import { hasTerminalResult, isTerminal } from './run-state';
import { Setup } from './components/setup';
import { Confirm } from './components/confirm';
import { Activity } from './components/activity';
import { Results } from './components/results';
import { ModeBar } from './components/provenance';
import { ReceiptDrawer } from './components/receipt';
export function App() {
  const booking=useBooking(),heading=useRef<HTMLHeadingElement>(null);
  const [receipt,setReceipt]=useState<{id:string;returnFocus:HTMLElement|null}|null>(null);
  const completed=booking.view?.state==='done'&&hasTerminalResult(booking.view);
  const fixture=booking.health?.qloo.mode==='fixture'||!!booking.view?.result?.brief?.origins.includes('fixture');
  const step=booking.stage==='setup'?0:booking.stage==='confirm'?1:2;
  useEffect(()=>{heading.current?.focus();},[booking.stage,completed]);
  const openReceipt=(id:string)=>setReceipt({id,returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:null});
  return <>
    <div inert={receipt!==null} className="workspace-shell">
      <a className="skip-link" href="#workspace">Skip to booking workspace</a>
      <header className="site-header"><a href="#workspace" className="brand" aria-label="OpenerFit booking workspace"><span className="brand-stamp" aria-hidden="true">of.</span><span>OpenerFit<small>Independent venue desk</small></span></a><div className="header-note"><span aria-hidden="true">↗</span> A good bill starts with your roster.</div></header>
      <ModeBar health={booking.health} brief={booking.view?.result?.brief??null}/>
      <main id="workspace" className="workspace">
        <div className="workspace-intro"><div><p className="eyebrow">The opener brief / taste, evidence, constraints</p><h1>Make the bill.<br/><span>Keep the working.</span></h1><p className="intro-copy">Find support acts in your own roster and co-promotion partners beyond the stage. Every brief fact comes with a source you can inspect.</p></div><aside className="desk-note"><span className="note-rule"/><p>Affinity is taste overlap.<br/>The booking call is yours.</p><span className="note-index">BOOKING DESK / 01</span></aside></div>
        <nav className="step-nav" aria-label="Brief progress"><ol>{['Event & roster','Confirm identities','Booking brief'].map((label,index)=><li key={label} aria-current={step===index?'step':undefined} className={step>=index?'reached':''}><span>{String(index+1).padStart(2,'0')}</span>{label}{index<2&&<span className="step-divider" aria-hidden="true">/</span>}</li>)}</ol></nav>
        <div className="stage-heading"><div><p className="eyebrow">Step {step+1} of 3</p><h2 ref={heading} tabIndex={-1}>{booking.stage==='setup'?'Set the scene.':booking.stage==='confirm'?'Put names to the right acts.':completed?'Your booking brief.':'Follow the working.'}</h2></div>{booking.stage==='run'&&booking.view&&isTerminal(booking.view.state)&&<div className="terminal-actions"><button type="button" disabled={booking.pending!==null} onClick={booking.back}>← Edit event or roster</button>{booking.view.state==='failed'&&<button type="button" disabled={booking.pending!==null} onClick={()=>void booking.start()}>Retry brief</button>}</div>}</div>
        {booking.failure&&<div role="alert" className="error-box"><strong>We couldn’t finish that request</strong><p>{booking.failure.message}</p><button type="button" onClick={booking.retry}>{booking.failure.code==='invalid_request'||booking.failure.code==='run_not_found'?'Resolve names again':'Retry'}</button></div>}
        {booking.pending==='resolve'&&<p className="resolve-progress" role="status">{COPY.resolving(booking.draft.roster.length+1)}</p>}
        {booking.stage==='setup'&&<Setup draft={booking.draft} edit={booking.edit} errors={booking.errors} scenarios={booking.scenarios} booting={booking.booting} fixture={fixture} pending={booking.pending!==null} storageAvailable={booking.storageAvailable} options={booking.options} setOptions={booking.setOptions} onSubmit={()=>void booking.resolve()} hasMatches={booking.resolved!==null}/>}
        {booking.stage==='confirm'&&booking.resolved&&<Confirm resolved={booking.resolved} choices={booking.choices} onChange={booking.setChoices} onBack={booking.back} onStart={()=>void booking.start()} pending={booking.pending!==null}/>}
        {booking.stage==='run'&&booking.view&&<>
          <Activity view={booking.view} pending={booking.pending==='cancel'} onCancel={()=>void booking.cancel()} onReconnect={()=>void booking.reconnect()} onReceipt={openReceipt}/>
          {completed&&booking.view.result&&<Results run={booking.view.result} fixture={fixture} onReceipt={openReceipt}/>}
        </>}
        {!completed&&<footer className="policy-footer"><span className="eyebrow">The boundary</span><p>{COPY.disclaimer}</p></footer>}
      </main>
      <footer className="site-footer"><span>OpenerFit / Independent venue desk</span><span>Evidence before certainty.</span></footer>
    </div>
    {receipt&&booking.view&&<ReceiptDrawer runId={booking.view.id} id={receipt.id} returnFocus={receipt.returnFocus} onClose={()=>setReceipt(null)}/>}
  </>;
}
