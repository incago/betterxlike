const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'../..');
test('inline video overlay toggles playback without opening the post popup',async({page})=>{
 await page.route('**/video-modal-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><main data-bxl-grid><article data-testid="tweet" role="button"><a href="/writer/status/123"><time>Today</time></a><p id="tweet-body">Open this tweet</p><div data-testid="videoComponent" style="position:relative;width:320px;height:180px"><div data-testid="videoPlayer"><video muted playsinline style="width:320px;height:180px"></video><div id="video-overlay" style="position:absolute;inset:0"></div><button id="play" style="position:absolute;left:140px;top:70px">Play</button></div></div></article></main></body></html>`}));
 await page.goto('/video-modal-test');
 await page.addStyleTag({path:path.join(root,'tweet-modal.css')});
 await page.evaluate(()=>{
  document.documentElement.setAttribute('data-bxl-active','');
  document.documentElement.setAttribute('data-bxl-path',location.pathname);
  window.chrome={runtime:{id:'test-extension'},i18n:{getMessage:key=>key},storage:{local:{get:(_,cb)=>cb({enabled:true,tweetPopup:true})},onChanged:{addListener:()=>{}}}};
 });
 await page.addScriptTag({path:path.join(root,'video-play.js')});
 await page.addScriptTag({path:path.join(root,'video.js')});
 await page.evaluate(()=>{
  window.videoPolicy=new BxlVideoPolicy(()=>true);
  window.videoPolicy.update(document.querySelector('[data-bxl-grid]'));
 });
 await page.addScriptTag({path:path.join(root,'tweet-modal.js')});
 await page.evaluate(()=>{
  const video=document.querySelector('video');
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  const ctx=canvas.getContext('2d');
  const timer=setInterval(()=>{ctx.fillStyle='blue';ctx.fillRect(0,0,320,180);},50);
  video.srcObject=canvas.captureStream(20);
  document.querySelector('[data-testid="videoComponent"]').addEventListener('click',()=>{
   if(video.paused)video.play().catch(error=>{window.playbackError=error.name;});else video.pause();
   document.querySelector('#play').hidden=true;
  });
  addEventListener('pagehide',()=>{clearInterval(timer);video.srcObject.getTracks().forEach(track=>track.stop());});
 });
 const video=page.locator('video');
 await page.locator('#play').click();
 await expect(video).toHaveJSProperty('paused',false);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('#video-overlay').click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(video).toHaveJSProperty('paused',true);
 await page.locator('#video-overlay').click();
 await expect(video).toHaveJSProperty('paused',false);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('#video-overlay').click();
 await expect(video).toHaveJSProperty('paused',true);
 await page.locator('#tweet-body').click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('#video-overlay').click();
 await expect(video).toHaveJSProperty('paused',false);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('#video-overlay').click();
 await expect(video).toHaveJSProperty('paused',true);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>window.playbackError)).toBeUndefined();
});

for(const width of [500,1440])test(`conversation popup keeps native scroll and focus at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/modal-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0;min-height:3000px"><main data-bxl-grid style="padding-top:600px"><article data-testid="tweet" role="button"><a id="timestamp" href="/writer/status/123"><time>Today</time></a><p id="tweet-body">Open this tweet</p><button id="like">Like</button></article></main></body></html>`}));
 await page.goto('/modal-test');
 await page.addStyleTag({path:path.join(root,'tweet-modal.css')});
 await page.evaluate(catalog=>{
  document.documentElement.setAttribute('data-bxl-active','');document.documentElement.setAttribute('data-bxl-path',location.pathname);
  window.readerMessages=[];window.readerClosed=0;
  document.addEventListener('bxl-reader-request',e=>{
   const m=JSON.parse(e.detail);window.readerMessages.push(m);if(m.type==='close')window.readerClosed++;
   if(m.type==='open')window.readerReceive=payload=>document.dispatchEvent(new CustomEvent('bxl-reader-response',{detail:JSON.stringify({token:m.token,...payload})}));
  });
  window.chrome={runtime:{id:'test-extension'},i18n:{getMessage:(key,sub)=>catalog[key]?.message.replace('$1',sub)||key},storage:{local:{get:(_,cb)=>cb({enabled:true,tweetPopup:true})},onChanged:{addListener:fn=>window.readerSetting=fn}}};
 },JSON.parse(fs.readFileSync(path.join(root,'_locales/en/messages.json'),'utf8')));
 await page.addScriptTag({path:path.join(root,'tweet-modal.js')});
 await page.evaluate(()=>scrollTo(0,380));
 const before=await page.locator('#timestamp').boundingBox();
 const pagesBefore=page.context().pages().length;
 await page.mouse.click(before.x+5,before.y+5);
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(await page.evaluate(()=>scrollY)).toBe(380);
 await page.evaluate(()=>window.readerReceive({type:'data',posts:[{id:'123',handle:'writer',name:'Writer',text:'Complete body\n'.repeat(60),lang:'ar'},{id:'456',handle:'reader',text:'Reply',replyTo:'123'},{id:'789',handle:'other',text:'Unrelated recommendation'}]}));
 await expect(page.locator('.bxl-reader-post')).toHaveCount(1);
 expect(page.context().pages().length).toBe(pagesBefore);
 expect(new URL(page.url()).pathname).toBe('/modal-test');
 const box=await page.getByRole('dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await expect(page.locator('dialog h2,dialog h3,.bxl-reader-more')).toHaveCount(0);
 await page.getByRole('button',{name:'Translate post',exact:true}).click();
 expect(await page.evaluate(()=>window.readerMessages.some(m=>m.type==='translate'))).toBe(true);
 await page.evaluate(()=>window.readerReceive({type:'translation',text:'Translated content'}));
 await expect(page.locator('.bxl-reader-text')).toHaveText('Translated content');
 await page.getByRole('button',{name:'Show original',exact:true}).click();
 await expect(page.locator('.bxl-reader-text')).toContainText('Complete body');
 expect(await page.evaluate(()=>scrollY)).toBe(380);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>scrollY)).toBe(380);expect(await page.evaluate(()=>window.readerClosed)).toBe(1);await expect(page.locator('#timestamp')).toBeFocused();
 const after=await page.locator('#timestamp').boundingBox();expect(after.y).toBe(before.y);
 await page.locator('#tweet-body').click();await page.evaluate(()=>window.readerSetting({tweetPopup:{newValue:false}},'local'));
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>window.readerClosed)).toBe(2);
});
