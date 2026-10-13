const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
function setup(popup=true){
 const dom=new JSDOM(`<body><main data-bxl-grid><article data-testid="tweet" role="button"><a id="time" href="/writer/status/123"><time>Today</time></a><p id="body">Body</p><button id="like">Like</button><a id="profile" href="/writer">Writer</a><a id="photo" href="/writer/status/123/photo/1">Photo</a></article></main></body>`,{url:'https://x.com/i/history/likes',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const root=w.document.documentElement;root.setAttribute('data-bxl-active','');root.setAttribute('data-bxl-path','/i/history/likes');
 const messages=[];const receive=[];const change=[];let disconnects=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.scrollTo=options=>messages.push({scroll:options});
 w.document.addEventListener('bxl-reader-request',e=>{
  const m=JSON.parse(e.detail);messages.push(m);if(m.type==='close')disconnects++;
  if(m.type==='open')receive.push(payload=>w.document.dispatchEvent(new w.CustomEvent('bxl-reader-response',{detail:JSON.stringify({token:m.token,...payload})})));
 });
 w.chrome={i18n:{getMessage:(key,sub)=>key+(sub||'')},runtime:{id:'test-extension'},storage:{local:{get:(_,cb)=>cb({enabled:true,tweetPopup:popup})},onChanged:{addListener:f=>change.push(f)}}};
 w.eval(fs.readFileSync('tweet-modal.js','utf8'));
 return {w,doc:w.document,messages,receive,change,disconnects:()=>disconnects,close:()=>w.close()};
}
test('popup preserves existing timeline, renders long content safely, omits replies and restores focus',t=>{
 const p=setup();t.after(p.close);const article=p.doc.querySelector('article');
 p.doc.querySelector('#body').click();assert.ok(p.doc.querySelector('dialog'));assert.ok(p.messages.some(m=>m.type==='open'));
 p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'<img src=x onerror=alert(1)>'.repeat(100),media:[{type:'photo',url:'javascript:alert(1)'}]},{id:'2',handle:'reader',text:'reply',replyTo:'123'},{id:'3',handle:'reader',text:'nested',replyTo:'2'},{id:'4',handle:'other',text:'recommendation'}]});
 assert.equal(p.doc.querySelectorAll('.bxl-reader-post').length,1);assert.equal(p.doc.querySelectorAll('.bxl-reader-post img').length,0);
 assert.ok(p.doc.querySelector('.bxl-reader-text').textContent.length>2000);
 assert.equal(p.doc.querySelector('main article'),article);
 p.doc.querySelector('dialog').dispatchEvent(new p.w.Event('cancel',{cancelable:true}));
 assert.equal(p.doc.querySelector('dialog'),null);assert.equal(p.disconnects(),1);assert.equal(p.doc.activeElement.id,'time');assert.ok(p.messages.some(m=>m.scroll));
});
test('option off, modified clicks, controls and media/profile links stay native',t=>{
 const p=setup();t.after(p.close);
 for(const id of ['like','profile','photo']){const ev=new p.w.MouseEvent('click',{bubbles:true,cancelable:true});p.doc.querySelector('#'+id).dispatchEvent(ev);assert.equal(ev.defaultPrevented,false);}
 const modified=new p.w.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});p.doc.querySelector('#time').dispatchEvent(modified);assert.equal(modified.defaultPrevented,false);assert.equal(p.messages.length,0);
 p.change[0]({tweetPopup:{newValue:false}},'local');p.doc.querySelector('#body').click();assert.equal(p.doc.querySelector('dialog'),null);
});
test('settings off and navigation close modal and cancel the in-page request',async t=>{
 const p=setup();t.after(p.close);p.doc.querySelector('#body').click();p.change[0]({enabled:{newValue:false}},'local');assert.equal(p.doc.querySelector('dialog'),null);
 p.change[0]({enabled:{newValue:true}},'local');p.doc.querySelector('#body').click();p.doc.documentElement.removeAttribute('data-bxl-active');await new Promise(resolve=>p.w.queueMicrotask(resolve));assert.equal(p.doc.querySelector('dialog'),null);assert.equal(p.disconnects(),2);
});

test('later full text replaces an early preview without losing the conversation',t=>{
 const p=setup();t.after(p.close);p.doc.querySelector('#body').click();
 p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'preview'}]});
 p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'complete body',long:true}]});
 p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'preview'}]});
 assert.equal(p.doc.querySelector('.bxl-reader-text').textContent,'complete body');
 assert.equal(p.doc.querySelectorAll('.bxl-reader-post').length,1);
});

test('translation is requested on click, toggles without refetching, and failures leave original intact',t=>{
 const p=setup();t.after(p.close);p.doc.querySelector('#body').click();
 p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'Original body',lang:'ar'},{id:'456',handle:'reader',text:'Reply',replyTo:'123'}]});
 assert.equal(p.doc.querySelector('dialog h2'),null);assert.equal(p.doc.querySelector('dialog h3'),null);assert.equal(p.doc.querySelector('.bxl-reader-more'),null);
 assert.equal(p.doc.querySelectorAll('.bxl-reader-post').length,1);
 const button=p.doc.querySelector('.bxl-reader-translate');button.click();assert.equal(button.disabled,true);
 assert.equal(p.messages.filter(m=>m.type==='translate').length,1);
 p.receive[0]({type:'translation',error:true});assert.equal(button.disabled,false);assert.equal(p.doc.querySelector('.bxl-reader-text').textContent,'Original body');
 button.click();p.receive[0]({type:'translation',text:'Translated <img src=x>'});
 assert.equal(p.doc.querySelector('.bxl-reader-text').textContent,'Translated <img src=x>');assert.equal(p.doc.querySelector('.bxl-reader-text img'),null);
 button.click();assert.equal(p.doc.querySelector('.bxl-reader-text').textContent,'Original body');
 button.click();assert.equal(p.doc.querySelector('.bxl-reader-text').textContent,'Translated <img src=x>');assert.equal(p.messages.filter(m=>m.type==='translate').length,2);
});
test('popup follows X page colors, independent of operating system theme',async t=>{
 const p=setup();t.after(p.close);p.doc.body.style.backgroundColor='rgb(0, 0, 0)';p.doc.querySelector('#body').click();
 assert.equal(p.doc.querySelector('dialog').dataset.theme,'dark');
 p.doc.body.style.backgroundColor='rgb(255, 255, 255)';await new Promise(setImmediate);assert.equal(p.doc.querySelector('dialog').dataset.theme,'light');
 p.doc.body.style.backgroundColor='rgb(21, 32, 43)';await new Promise(setImmediate);assert.equal(p.doc.querySelector('dialog').dataset.theme,'dim');
});

test('extension reload retires old popup callbacks and restores the page without API errors',t=>{
 const p=setup();t.after(p.close);const errors=[];p.w.addEventListener('error',e=>errors.push(e.error));
 p.doc.querySelector('#body').click();p.receive[0]({type:'data',posts:[{id:'123',handle:'writer',text:'original',lang:'ar'}]});
 p.doc.querySelector('.bxl-reader-translate').click();
 p.w.chrome.i18n.getMessage=()=>{throw Error('Extension context invalidated.');};
 Object.defineProperty(p.w.chrome.runtime,'id',{get(){throw Error('Extension context invalidated.');}});
 // A late response after reload used to touch the invalid extension context.
 p.receive[0]({type:'translation',text:'translated'});
 assert.equal(p.doc.querySelector('dialog'),null);assert.equal(p.doc.documentElement.hasAttribute('data-bxl-popup-open'),false);
 const click=new p.w.MouseEvent('click',{bubbles:true,cancelable:true});p.doc.querySelector('#body').dispatchEvent(click);
 assert.equal(click.defaultPrevented,false);assert.equal(p.doc.querySelector('dialog'),null);assert.deepEqual(errors,[]);
});
test('closing still unlocks scrolling and focus when an old bridge throws',t=>{
 const p=setup();t.after(p.close);p.doc.querySelector('#body').click();
 const dispatch=p.doc.dispatchEvent.bind(p.doc);p.doc.dispatchEvent=e=>{if(e.type==='bxl-reader-request')throw Error('Extension context invalidated.');return dispatch(e);};
 p.doc.querySelector('.bxl-reader-close').click();assert.equal(p.doc.querySelector('dialog'),null);
 assert.equal(p.doc.documentElement.hasAttribute('data-bxl-popup-open'),false);assert.equal(p.doc.activeElement.id,'time');
});
