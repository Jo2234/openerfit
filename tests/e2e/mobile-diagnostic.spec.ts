import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('MOBILE-DIAGNOSTIC: 390×844 Load example setup geometry (evidence only)',async({page},testInfo)=>{
  testInfo.annotations.push({type:'diagnostic',description:'Collection success is not mobile acceptance. E5 remains the acceptance test.'});
  const consoleEvents:{type:string;messageLength:number;path:string;line:number;column:number}[]=[];
  const pageErrors:{name:string;messageLength:number;stackLineCount:number}[]=[];
  const apiPaths:string[]=[];
  let consoleCount=0,pageErrorCount=0,forbiddenApiCount=0;
  page.on('console',message=>{
    if(!['warning','error'].includes(message.type()))return;
    consoleCount++;
    if(consoleEvents.length>=12)return;
    const location=message.location();let path='';
    try{path=new URL(location.url).pathname.slice(0,180);}catch{/* No raw URL fallback. */}
    // Length/location metadata only: no console payload or input contents.
    consoleEvents.push({type:message.type(),messageLength:message.text().length,path,line:location.lineNumber,column:location.columnNumber});
  });
  page.on('pageerror',error=>{
    pageErrorCount++;
    if(pageErrors.length<12)pageErrors.push({name:error.name.slice(0,80),messageLength:error.message.length,stackLineCount:error.stack?.split('\n').length??0});
  });
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(path.startsWith('/api/')&&apiPaths.length<24)apiPaths.push(path.slice(0,180));
    if(/^\/api\/(resolve|runs)(\/|$)/.test(path))forbiddenApiCount++;
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Load example',exact:true}).click();
  await expect(page.getByLabel('Headliner',{exact:true})).toHaveValue('Harbour Lights');

  const geometry=await page.evaluate(()=>{
    const limits={elements:3000,textNodes:1500,textRects:3000,rectsPerTextNode:8,ancestors:6,pseudoOwners:600,
      ownSample:12,containedSample:6,textSample:12,pseudoSample:12,idChars:120,classChars:160,styleChars:120};
    const cut=(value:string)=>value.slice(0,limits.styleChars);
    const identity=(element:Element)=>({tag:element.tagName.slice(0,40),id:element.id.slice(0,limits.idChars),classes:(element.getAttribute('class')??'').slice(0,limits.classChars)});
    const rect=(bounds:DOMRect)=>({left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,width:bounds.width,height:bounds.height});
    const computed=(element:Element,pseudo?:'::before'|'::after')=>{
      const style=getComputedStyle(element,pseudo);
      return {display:cut(style.display),position:cut(style.position),boxSizing:cut(style.boxSizing),overflowX:cut(style.overflowX),overflowY:cut(style.overflowY),
        whiteSpace:cut(style.whiteSpace),overflowWrap:cut(style.overflowWrap),wordBreak:cut(style.wordBreak),width:cut(style.width),minWidth:cut(style.minWidth),maxWidth:cut(style.maxWidth),height:cut(style.height),
        left:cut(style.left),right:cut(style.right),top:cut(style.top),bottom:cut(style.bottom),
        margin:{left:cut(style.marginLeft),right:cut(style.marginRight),top:cut(style.marginTop),bottom:cut(style.marginBottom)},
        padding:{left:cut(style.paddingLeft),right:cut(style.paddingRight),top:cut(style.paddingTop),bottom:cut(style.paddingBottom)},
        clip:cut(style.clip),clipPath:cut(style.clipPath),contain:cut(style.contain),transform:cut(style.transform)};
    };
    const describe=(element:Element)=>({...identity(element),bounds:rect(element.getBoundingClientRect()),clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
      inputType:element.tagName==='INPUT'?(element.getAttribute('type')??'text').slice(0,32):null,computed:computed(element)});
    const pseudo=(element:Element,kind:'::before'|'::after')=>{
      const content=getComputedStyle(element,kind).content;
      return {kind,generated:content!=='none'&&content!=='normal',contentPresent:!['none','normal','""',"''"].includes(content.trim()),computed:computed(element,kind)};
    };
    const context=(element:Element)=>{
      const ancestors:ReturnType<typeof describe>[]=[];let parent=element.parentElement;
      while(parent&&ancestors.length<limits.ancestors){ancestors.push(describe(parent));parent=parent.parentElement;}
      const scroller=element.closest('.table-scroll'),bounds=scroller?.getBoundingClientRect();
      const offsetParent=element instanceof HTMLElement?element.offsetParent:null;
      const position=getComputedStyle(element).position;
      const positionedOutsideScroller=!!scroller&&['absolute','fixed'].includes(position)&&
        (position==='fixed'||!offsetParent||!(offsetParent===scroller||scroller.contains(offsetParent)));
      const intentionalTable=!!bounds&&bounds.left>=0&&bounds.right<=innerWidth&&!positionedOutsideScroller;
      return {intentionalTable,positionedOutsideScroller,tableScroll:scroller?describe(scroller):null,offsetParent:offsetParent?describe(offsetParent):null,
        ancestors,ancestorScanTruncated:!!parent,clippingAncestors:ancestors.filter(a=>a.computed.overflowX!=='visible'||a.computed.overflowY!=='visible'||a.computed.clip!=='auto'||a.computed.clipPath!=='none')};
    };
    const allElements=Array.from(document.body.querySelectorAll('*'));
    const scanned=[document.documentElement,document.body,...allElements].slice(0,limits.elements);
    const ownCandidates=scanned.flatMap(element=>{
      const bounds=element.getBoundingClientRect();
      const rectOutside=!!bounds.width&&(bounds.left<0||bounds.right>innerWidth);
      const internalOverflow=element.scrollWidth>element.clientWidth;
      if(!rectOutside&&!internalOverflow)return [];
      return [{element,rectOutside,internalOverflow,fitted:bounds.left>=0&&bounds.right<=innerWidth,
        excess:Math.max(0,-bounds.left,bounds.right-innerWidth,element.scrollWidth-element.clientWidth)}];
    });
    // Classify before sampling; fitted rectangles never suppress scroll overflow.
    const own=ownCandidates.map(candidate=>({...candidate,context:context(candidate.element)}));
    const external=own.filter(candidate=>!candidate.context.intentionalTable).sort((a,b)=>b.excess-a.excess);
    const contained=own.filter(candidate=>candidate.context.intentionalTable).sort((a,b)=>b.excess-a.excess);
    const serialize=(candidate:typeof own[number])=>({own:describe(candidate.element),rectOutside:candidate.rectOutside,
      internalOverflow:candidate.internalOverflow,fitted:candidate.fitted,excess:candidate.excess,context:candidate.context});

    const textCandidates:{length:number;totalRects:number;scannedRects:number;overflowRects:ReturnType<typeof rect>[];parent:Element;excess:number}[]=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let textNodes=0,textRects=0,node:Node|null;
    while(textNodes<limits.textNodes&&textRects<limits.textRects&&(node=walker.nextNode())){
      textNodes++;const owner=node.parentElement;if(!owner||owner.closest('script,style,noscript,template'))continue;
      const range=document.createRange();range.selectNodeContents(node);
      const rectangles=range.getClientRects(),scan=Math.min(rectangles.length,limits.rectsPerTextNode,limits.textRects-textRects);
      const overflowRects=[];
      for(let index=0;index<scan;index++){
        const bounds=rectangles[index];textRects++;
        if(bounds.width&&(bounds.left<0||bounds.right>innerWidth))overflowRects.push(rect(bounds));
      }
      if(overflowRects.length)textCandidates.push({length:node.nodeValue?.length??0,totalRects:rectangles.length,scannedRects:scan,overflowRects,parent:owner,
        excess:Math.max(...overflowRects.map(r=>Math.max(0,-r.left,r.right-innerWidth)))});
    }
    const text=textCandidates.map(candidate=>({...candidate,context:context(candidate.parent)}));
    const textExternal=text.filter(candidate=>!candidate.context.intentionalTable).sort((a,b)=>b.excess-a.excess);
    const textContained=text.filter(candidate=>candidate.context.intentionalTable).sort((a,b)=>b.excess-a.excess);
    const serializeText=(candidate:typeof text[number])=>({length:candidate.length,totalRects:candidate.totalRects,scannedRects:candidate.scannedRects,
      overflowRects:candidate.overflowRects,parent:describe(candidate.parent),context:candidate.context});

    const pseudoCandidates=scanned.slice(0,limits.pseudoOwners).flatMap(element=>(['::before','::after'] as const).flatMap(kind=>{
      const details=pseudo(element,kind);return details.generated?[{owner:element,details,context:context(element)}]:[];
    }));
    const pseudoExternal=pseudoCandidates.filter(candidate=>!candidate.context.intentionalTable),pseudoContained=pseudoCandidates.filter(candidate=>candidate.context.intentionalTable);
    const serializePseudo=(candidate:typeof pseudoCandidates[number])=>({owner:describe(candidate.owner),pseudo:candidate.details,context:candidate.context});
    return {purpose:'Diagnostic collection only; success does not imply mobile acceptance.',limits,
      viewport:{width:innerWidth,height:innerHeight,scrollX,visualWidth:visualViewport?.width??null,visualOffsetLeft:visualViewport?.offsetLeft??null},
      document:{noPageOverflow:document.documentElement.scrollWidth<=innerWidth,html:describe(document.documentElement),body:describe(document.body),
        htmlPseudos:[pseudo(document.documentElement,'::before'),pseudo(document.documentElement,'::after')],bodyPseudos:[pseudo(document.body,'::before'),pseudo(document.body,'::after')]},
      elementScan:{total:allElements.length+2,scanned:scanned.length,truncated:allElements.length+2>limits.elements},
      externalCandidates:{count:external.length,sample:external.slice(0,limits.ownSample).map(serialize)},
      fittedInternalOverflow:{count:external.filter(candidate=>candidate.fitted&&candidate.internalOverflow).length,
        sample:external.filter(candidate=>candidate.fitted&&candidate.internalOverflow).slice(0,limits.ownSample).map(serialize)},
      intentionalTableCandidates:{count:contained.length,sample:contained.slice(0,limits.containedSample).map(serialize)},
      textScan:{nodes:textNodes,rectangles:textRects,budgetReached:textNodes===limits.textNodes||textRects===limits.textRects,perNodeRectLimit:limits.rectsPerTextNode},
      externalTextOverflow:{count:textExternal.length,sample:textExternal.slice(0,limits.textSample).map(serializeText)},
      intentionalTableTextOverflow:{count:textContained.length,sample:textContained.slice(0,limits.containedSample).map(serializeText)},
      pseudoScan:{owners:Math.min(scanned.length,limits.pseudoOwners),generatedCount:pseudoCandidates.length},
      externalPseudos:{count:pseudoExternal.length,sample:pseudoExternal.slice(0,limits.pseudoSample).map(serializePseudo)},
      intentionalTablePseudos:{count:pseudoContained.length,sample:pseudoContained.slice(0,limits.containedSample).map(serializePseudo)},
      limitations:['Pseudo bounds are owner bounds plus computed pseudo geometry, not measured pseudo rectangles.','Closed native-control/shadow internals are not inspected.','Text and ancestor scans are bounded; no text contents or form values are recorded.']};
  });
  await page.screenshot({path:testInfo.outputPath('setup.png'),fullPage:true});
  const evidence={geometry,runtime:{consoleCount,consoleSample:consoleEvents,pageErrorCount,pageErrorSample:pageErrors,apiPaths,forbiddenApiCount}};
  const path=testInfo.outputPath('setup-geometry.json');
  await writeFile(path,JSON.stringify(evidence,null,2)+'\n');
  await testInfo.attach('setup-geometry',{path,contentType:'application/json'});
  // Collection/configuration invariants only. Do not assert away known overflow.
  expect(geometry.viewport.width).toBe(390);
  expect(forbiddenApiCount).toBe(0);
});
