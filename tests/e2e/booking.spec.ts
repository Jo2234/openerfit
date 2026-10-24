import { test, expect, type Locator, type Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { decodeNumericReferencesOnce } from './markdown-text';
async function loadExample(page:Page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Load example',exact:true}).click();
  await expect(page.getByLabel('Headliner',{exact:true})).toHaveValue('Harbour Lights');
}
async function confirmDefault(page:Page) {
  await page.getByRole('button',{name:/Find matches/}).click();
  await expect(page.getByRole('heading',{name:'Put names to the right acts.'})).toBeVisible();
  await page.getByRole('group',{name:/Moth Parade/}).getByRole('radio',{name:/2019, Singapore indie/}).check();
  await page.getByRole('group',{name:/Velvet Monsoon/}).getByRole('radio',{name:/Velvet Monsoon Trio/}).check();
  await page.getByRole('button',{name:/Build brief/}).click();
  await expect(page.getByRole('heading',{name:'Your booking brief.',exact:true})).toBeVisible();
}
async function keyboardActivate(page:Page,target:Locator,key='Enter') {
  for(let i=0;i<180;i++){
    if(await target.evaluate(el=>el===document.activeElement)){await page.keyboard.press(key);return;}
    await page.keyboard.press('Tab');
  }
  throw new Error('Target was not reachable through keyboard tab order.');
}
test('E1: real default resolve, confirmations, stream, receipts and server exports',async({page},testInfo)=>{
  const requested:string[]=[];page.on('request',request=>{if(request.url().includes('/api/'))requested.push(new URL(request.url()).pathname);});
  // Observe actual native EventSource delivery, not a fabricated fetch/stream.
  // Both a live sequence and the server's terminal replay are valid.
  await page.addInitScript(()=>{
    const NativeEventSource=window.EventSource;
    const records:{path:string;stepIndexes:number[];states:string[];terminal:{id:string;state:string;briefRunId:string|null;stepIndexes:number[]}|null}[]=[];
    Object.assign(window,{__openerfitStreamEvidence:records});
    window.EventSource=class extends NativeEventSource {
      constructor(url:string|URL,options?:EventSourceInit){
        super(url,options);
        const record:typeof records[number]={path:new URL(String(url),location.href).pathname,stepIndexes:[],states:[],terminal:null};records.push(record);
        this.addEventListener('state',event=>record.states.push(JSON.parse((event as MessageEvent).data).state));
        this.addEventListener('step',event=>record.stepIndexes.push(JSON.parse((event as MessageEvent).data).index));
        this.addEventListener('done',event=>{const payload=JSON.parse((event as MessageEvent).data);record.terminal={id:payload.id,state:payload.state,briefRunId:payload.brief?.runId??null,stepIndexes:payload.steps.map((step:{index:number})=>step.index)};});
      }
    };
  });
  const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/runs'&&response.request().method()==='POST');
  await loadExample(page);await confirmDefault(page);
  const {runId}=await(await creation).json();expect(runId).toMatch(/^run_[a-f0-9]{32}$/);
  const streamPath=`/api/runs/${runId}/events`;
  await expect.poll(()=>page.evaluate(path=>{
    const records=(window as unknown as {__openerfitStreamEvidence:{path:string;stepIndexes:number[];states:string[];terminal:{id:string;state:string;briefRunId:string|null;stepIndexes:number[]}|null}[]}).__openerfitStreamEvidence;
    const stream=records.find(record=>record.path===path);
    return stream?{steps:stream.stepIndexes.length,terminal:stream.terminal?.state??null}:null;
  },streamPath)).toMatchObject({steps:expect.any(Number),terminal:'done'});
  const streamEvidence=await page.evaluate(path=>(window as unknown as {__openerfitStreamEvidence:{path:string;stepIndexes:number[];states:string[];terminal:{id:string;state:string;briefRunId:string|null;stepIndexes:number[]}}[]}).__openerfitStreamEvidence.find(record=>record.path===path)!,streamPath);
  expect(streamEvidence.stepIndexes.length).toBeGreaterThan(0);expect(streamEvidence.states).toContain('done');
  expect(streamEvidence.terminal.id).toBe(runId);expect(streamEvidence.terminal.briefRunId).toBe(runId);
  for(const index of streamEvidence.stepIndexes)expect(streamEvidence.terminal.stepIndexes).toContain(index);
  expect(requested).toContain('/api/resolve');expect(requested).toContain('/api/runs');expect(requested).toContain(streamPath);
  const ranking=page.getByRole('region',{name:'Opener affinity ranking'});
  const acts=ranking.getByRole('row');
  for(const [index,name]of ['Saltwater Static','Kopi Noir','Paper Lantern Club','Moth Parade','Lantern Choir','Velvet Monsoon Trio','Neon Durian','Echo Park Ferry'].entries())await expect(acts.nth(index+1)).toContainText(name);
  await expect(ranking.getByRole('row',{name:/Saltwater Static/})).toContainText('Shortlist');
  await expect(ranking.getByRole('row',{name:/Kopi Noir/})).toContainText('Over budget');
  await expect(ranking.getByRole('row',{name:/Neon Durian/})).toContainText(COPY.noAffinity);
  await page.getByText(/Agent trace ·/).click();
  await expect(page.getByText('rank_roster',{exact:true})).toBeVisible();
  await expect(page.getByText('search_tags',{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('desktop-brief.png'),fullPage:true});
  await ranking.getByRole('row',{name:/Saltwater Static/}).getByRole('button',{name:/Receipt /}).click();
  const drawer=page.getByRole('dialog');await expect(drawer.getByTestId('raw-receipt-value')).toHaveText('0.9127');
  await expect(drawer.getByText('results.entities[0].query.affinity',{exact:true})).toBeVisible();
  await expect(drawer.getByText(/No raw entity excerpt/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('receipt-drawer.png')});
  await drawer.getByRole('button',{name:'Close receipt'}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:/Export Markdown/}).click();const download=await downloadPromise;
  const stream=await download.createReadStream();if(!stream)throw new Error('Markdown download stream unavailable');const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const markdown=Buffer.concat(chunks).toString('utf8');
  // The accepted exporter encodes punctuation. Decode once as inert text,
  // independently of production escaping; keep the exact raw value assertion.
  expect(markdown.split(/\r?\n/)).toContain('Exact returned value: 0&#46;9127');
  const markdownLines=decodeNumericReferencesOnce(markdown).split(/\r?\n/);
  expect(markdownLines).toContain('Headliner input: Harbour Lights');
  expect(markdownLines).toContain('Exact returned value: 0.9127');
  expect(markdownLines).toContain(COPY.fixtureBanner);expect(markdownLines).toContain(COPY.disclaimer);
  const htmlLink=page.getByRole('link',{name:/Open printable brief/});const html=await page.request.get((await htmlLink.getAttribute('href'))!);expect(html.status()).toBe(200);expect(html.headers()['content-type']).toContain('text/html');expect(await html.text()).toContain('Harbour Lights');
});
test('E2: fixture comparison has six moved positions, tau 0.2 and independent provenance',async({page})=>{
  await loadExample(page);await confirmDefault(page);await page.getByRole('switch',{name:/Compare with LLM-only/}).click();
  await expect(page.getByRole('heading',{name:'Ranking comparison',exact:true})).toBeVisible();
  await expect(page.getByText('6 of 6 jointly ranked opener positions differ · 2 baseline partner picks have no Qloo receipt · 1 baseline sentence breaks the copy rules',{exact:true})).toBeVisible();
  await expect(page.getByText('Kendall tau-b: 0.2',{exact:true})).toBeVisible();await expect(page.getByText(COPY.baselineFixture,{exact:true})).toBeVisible();
  await expect(page.getByLabel('Brief selector provenance')).toContainText('Selection source: hand-written fixture, not a model output.');
  await expect(page.getByText(/The Strokes Tribute Band/)).toBeVisible();await expect(page.getByText(/Generic Energy Drink Co\./)).toBeVisible();
});
test('E3: synthetic 503 shows safe copy and actionable retry preserves input',async({page})=>{
  let failed=false;await page.route('**/api/resolve',async route=>{if(!failed){failed=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'qloo_unavailable',message:'synthetic upstream unavailable'}})});}else await route.continue();});
  await loadExample(page);await page.getByRole('button',{name:/Find matches/}).click();await expect(page.getByRole('alert')).toContainText(COPY.qlooUnavailable);await expect(page.getByLabel('Headliner',{exact:true})).toHaveValue('Harbour Lights');
  await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('heading',{name:'Put names to the right acts.'})).toBeVisible();
});
test('E4: keyboard-only default path and receipt Escape restores focus',async({page})=>{
  await page.goto('/');await keyboardActivate(page,page.getByRole('button',{name:'Load example',exact:true}));await keyboardActivate(page,page.getByRole('button',{name:/Find matches/}));
  await expect(page.getByRole('heading',{name:'Put names to the right acts.'})).toBeVisible();
  await keyboardActivate(page,page.getByRole('group',{name:/Moth Parade/}).getByRole('radio',{name:/2019, Singapore indie/}),'Space');
  await keyboardActivate(page,page.getByRole('group',{name:/Velvet Monsoon/}).getByRole('radio',{name:/Velvet Monsoon Trio/}),'Space');
  await keyboardActivate(page,page.getByRole('button',{name:/Build brief/}));await expect(page.getByRole('heading',{name:'Your booking brief.',exact:true})).toBeVisible();
  const trigger=page.getByRole('region',{name:'Opener affinity ranking'}).getByRole('row',{name:/Saltwater Static/}).getByRole('button',{name:/Receipt /});
  await keyboardActivate(page,trigger);await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
});
test('E5: 390×844 setup, confirmation, results and drawer have no page-wide overflow',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await loadExample(page);
  const noOverflow=async(stage:string)=>{
    const geometry=await page.evaluate(()=>{
      const elements=Array.from(document.body.querySelectorAll('*'));
      // Inert geometry only; limit scans, metadata lengths and each sample.
      const identify=(element:Element)=>({tag:element.tagName,id:element.id.slice(0,120),classes:(element.getAttribute('class')??'').slice(0,160)});
      const describe=(element:Element)=>{
        const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
        return {...identify(element),left:bounds.left,right:bounds.right,width:bounds.width,
          clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,position:style.position,
          overflowX:style.overflowX,overflowY:style.overflowY,clip:style.clip.slice(0,120),clipPath:style.clipPath.slice(0,120),
          contain:style.contain,transform:style.transform.slice(0,160)};
      };
      const outliers=elements.slice(0,3000).flatMap(element=>{
        const bounds=element.getBoundingClientRect();
        if(!bounds.width||(bounds.left>=0&&bounds.right<=window.innerWidth))return [];
        const details=describe(element),scrollRegion=element.closest('.table-scroll');
        const regionBounds=scrollRegion?.getBoundingClientRect();
        const offsetParent=element instanceof HTMLElement?element.offsetParent:null;
        const positioned=details.position==='absolute'||details.position==='fixed';
        const offsetParentInsideScroll=scrollRegion?!!offsetParent&&(offsetParent===scrollRegion||scrollRegion.contains(offsetParent)):null;
        // A risk signal, not proof of clipping behavior: report containing-block
        // metadata so intentional wide table content cannot bury this candidate.
        const positionedOutsideScroll=!!scrollRegion&&positioned&&(details.position==='fixed'||!offsetParentInsideScroll);
        const boundedScroll=!!regionBounds&&regionBounds.left>=0&&regionBounds.right<=window.innerWidth;
        const category=!boundedScroll?'outsideScroll':positionedOutsideScroll?'positionedOutsideScroll':'containedScroll';
        return [{...details,category,excess:Math.max(0,-bounds.left,bounds.right-window.innerWidth),
          offsetParent:offsetParent?describe(offsetParent):null,offsetParentInsideScroll,
          parent:element.parentElement?describe(element.parentElement):null,
          tableScroll:scrollRegion?describe(scrollRegion):null}];
      });
      const sorted=(category:string)=>outliers.filter(element=>element.category===category).sort((a,b)=>b.excess-a.excess);
      const outside=sorted('outsideScroll'),positioned=sorted('positionedOutsideScroll'),contained=sorted('containedScroll');
      return {noOverflow:document.documentElement.scrollWidth<=window.innerWidth,
        viewport:{width:window.innerWidth,height:window.innerHeight,scrollX:window.scrollX},
        document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth},
        totalElements:elements.length,scannedElements:Math.min(elements.length,3000),outlierCount:outliers.length,
        outsideScroll:{count:outside.length,sample:outside.slice(0,12)},
        positionedOutsideScroll:{count:positioned.length,sample:positioned.slice(0,12)},
        containedScroll:{count:contained.length,sample:contained.slice(0,6)}};
    });
    if(!geometry.noOverflow)await testInfo.attach(`overflow-${stage}`,{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
    expect(geometry.noOverflow,`${stage} page width: ${JSON.stringify(geometry)}`).toBe(true);
  };
  await noOverflow('setup');
  const categories=page.getByRole('group',{name:'Co-promotion partners',exact:true});
  await expect(categories.getByRole('checkbox')).toHaveCount(3);
  for(const name of ['Brands','Places near the venue','Podcasts']){
    const checkbox=categories.getByRole('checkbox',{name,exact:true}),label=checkbox.locator('..');
    await expect(checkbox).toBeVisible();const bounds=await label.boundingBox();
    expect(bounds?.width??0,`${name} label width`).toBeGreaterThan(0);expect(bounds?.height??0,`${name} label height`).toBeGreaterThan(0);
    const initial=await checkbox.isChecked();await label.click();
    if(initial)await expect(checkbox).not.toBeChecked();else await expect(checkbox).toBeChecked();
    await checkbox.focus();await page.keyboard.press('Space');await expect(checkbox).toBeFocused();
    if(initial)await expect(checkbox).toBeChecked();else await expect(checkbox).not.toBeChecked();
  }
  await page.getByRole('button',{name:/Find matches/}).click();await expect(page.getByRole('heading',{name:'Put names to the right acts.'})).toBeVisible();await noOverflow('confirmation');
  await page.getByRole('group',{name:/Moth Parade/}).getByRole('radio',{name:/2019, Singapore indie/}).check();await page.getByRole('group',{name:/Velvet Monsoon/}).getByRole('radio',{name:/Velvet Monsoon Trio/}).check();await page.getByRole('button',{name:/Build brief/}).click();await expect(page.getByRole('heading',{name:'Your booking brief.',exact:true})).toBeVisible();await noOverflow('results');
  const rankingScroll=page.getByRole('region',{name:'Opener affinity ranking',exact:true});
  const scrollBounds=await rankingScroll.boundingBox();expect(scrollBounds).not.toBeNull();
  expect(scrollBounds!.width).toBeGreaterThan(0);expect(scrollBounds!.x).toBeGreaterThanOrEqual(0);
  expect(scrollBounds!.x+scrollBounds!.width).toBeLessThanOrEqual(390);
  await expect(rankingScroll.getByRole('columnheader')).toHaveCount(6);
  expect(await rankingScroll.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
  await rankingScroll.focus();await expect(rankingScroll).toBeFocused();await rankingScroll.press('ArrowRight');
  await expect.poll(()=>rankingScroll.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  // Chromium animates keyboard scrolling even with CSS scroll-behavior: auto.
  // Do not reverse direction while the initial rightward scroll is in flight.
  await expect.poll(()=>rankingScroll.evaluate(async element=>{
    const previous=element.scrollLeft;
    await new Promise(resolve=>setTimeout(resolve,100));
    return previous>0&&element.scrollLeft===previous;
  })).toBe(true);
  await rankingScroll.press('ArrowLeft');await expect.poll(()=>rankingScroll.evaluate(element=>element.scrollLeft)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('mobile-brief.png'),fullPage:true});
  await page.getByRole('region',{name:'Opener affinity ranking'}).getByRole('row',{name:/Saltwater Static/}).getByRole('button',{name:/Receipt /}).click();await expect(page.getByRole('dialog')).toBeVisible();await noOverflow('receipt');await page.screenshot({path:testInfo.outputPath('mobile-receipt.png')});
});
