/* Read-only post modal; the original X timeline stays mounted. */
(() => {
  'use strict';
  // Extension APIs from an old content script stop working after reload/update.
  // Cache UI strings while the context is valid; late callbacks never call i18n.
  const strings=new Map();
  try {
    for(const key of ['readerTitle','readerOriginal','readerClose','readerLoading','readerError','readerTranslate','readerShowOriginal','readerTranslating','readerTranslationError'])strings.set(key,chrome.i18n.getMessage(key) || key);
  }catch{return;}
  const message=key=>strings.get(key) || key;
  const lifetime=new AbortController();
  let retired=false;let routeObserver=null;let themeObserver=null;
  const contextAlive=()=>{try{return Boolean(chrome.runtime?.id);}catch{return false;}};
  function activeContext() {
    if(retired)return false;
    if(contextAlive())return true;
    retired=true;enabled=false;popup=false;
    lifetime.abort();routeObserver?.disconnect();themeObserver?.disconnect();
    close();
    return false;
  }
  let enabled=false;let popup=false;let current=null;
  const useGrid=()=>activeContext() && enabled && popup && document.documentElement.hasAttribute('data-bxl-active') &&
    document.documentElement.getAttribute('data-bxl-path')===location.pathname+location.search;
  const element=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
  const mediaUrl=value=>{
    try {const url=new URL(value);return url.protocol==='https:' && /(^|\.)twimg\.com$/.test(url.hostname) ? url.href : null;} catch {return null;}
  };
  function close(restore=true) {
    const state=current;if(!state)return;current=null;
    clearTimeout(state.timeout);clearTimeout(state.translationTimeout);document.removeEventListener('bxl-reader-response',state.receive);
    // Cleanup must finish even if a bridge belonging to the old context throws.
    try {
      if(contextAlive())document.dispatchEvent(new CustomEvent('bxl-reader-request',{detail:JSON.stringify({type:'close',token:state.token})}));
    }catch{ /* The page and focus still need restoring after an extension reload. */ }
    state.dialog.close();state.dialog.remove();document.documentElement.removeAttribute('data-bxl-popup-open');
    if(restore && state.route===location.pathname+location.search){
      window.scrollTo({left:state.x,top:state.y,behavior:'instant'});
      if(state.focus?.isConnected)state.focus.focus({preventScroll:true});
    }
  }
  const decode=text=>text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  function theme(dialog) {
    const colors=[document.body,document.documentElement].map(el=>getComputedStyle(el).backgroundColor);
    const color=colors.find(value=>value && value!=='rgba(0, 0, 0, 0)' && value!=='transparent') || 'rgb(255, 255, 255)';
    const rgb=color.match(/[\d.]+/g)?.map(Number) || [255,255,255];
    dialog.dataset.theme=Math.max(...rgb.slice(0,3))>200?'light':Math.max(...rgb.slice(0,3))>15?'dim':'dark';
    const tweet=document.querySelector('[data-testid="tweetText"]');
    if(tweet)dialog.style.fontFamily=getComputedStyle(tweet).fontFamily;
  }
  function renderPost(post, isQuote=false) {
    const card=element('article',null,isQuote?'bxl-reader-quote':'bxl-reader-post');card.dataset.postId=post.id;
    const byline=element('a',null,'bxl-reader-author');
    byline.href=`${location.origin}/${post.handle}/status/${post.id}`;byline.target='_blank';byline.rel='noopener noreferrer';
    const avatar=mediaUrl(post.avatar);
    if(avatar){const img=element('img',null,'bxl-reader-avatar');img.src=avatar;img.alt='';byline.append(img);}
    const author=element('span');author.append(element('strong',post.name || post.handle),element('span',`@${post.handle}`,'bxl-reader-handle'));byline.append(author);card.append(byline);
    const text=element('p',decode(post.text),'bxl-reader-text');text.dir='auto';card.append(text);
    if(!isQuote){
      const targetLanguage=(document.documentElement.lang || navigator.language).split('-')[0];
      if(post.lang!==targetLanguage && post.lang!=='zxx'){
        const translate=element('button',message('readerTranslate'),'bxl-reader-translate');translate.type='button';
        const notice=element('p',null,'bxl-reader-translation-status');notice.setAttribute('role','status');notice.hidden=true;
        translate.addEventListener('click',()=>{
          if(!activeContext())return;
          const state=current;if(!state || state.id!==post.id)return;
          if(state.translated){text.textContent=decode(state.post.text);state.translated=false;translate.textContent=message('readerTranslate');return;}
          if(state.translation){text.textContent=decode(state.translation);state.translated=true;translate.textContent=message('readerShowOriginal');return;}
          translate.disabled=true;translate.textContent=message('readerTranslating');notice.hidden=true;
          state.translationTimeout=setTimeout(()=>translationResult(state,{error:true}),25000);
          state.send({type:'translate'});
        });
        card.append(translate,notice);
      }
    }
    for(const item of Array.isArray(post.media)?post.media.slice(0,4):[]) {
      const image=mediaUrl(item.url);if(!image)continue;
      const video=mediaUrl(item.video);
      if((item.type==='video' || item.type==='animated_gif') && video){
        const player=element('video');player.controls=true;player.preload='none';player.playsInline=true;player.poster=image;player.src=video;card.append(player);
      }else{const img=element('img');img.src=image;img.alt=item.alt || '';img.loading='lazy';card.append(img);}
    }
    const quote=post.quote;
    if(!isQuote && quote && /^\d+$/.test(quote.id) && /^[\w]{1,15}$/.test(quote.handle) && typeof quote.text==='string')card.append(renderPost(quote,true));
    if(post.createdAt){const time=element('time',new Date(post.createdAt).toLocaleString());card.append(time);}
    return card;
  }
  function translationResult(state,payload) {
    if(!activeContext() || current!==state)return;
    clearTimeout(state.translationTimeout);
    const button=state.content.querySelector('.bxl-reader-translate');if(!button)return;
    button.disabled=false;
    if(payload.error || typeof payload.text!=='string' || payload.text.length>50000){
      button.textContent=message('readerTranslate');
      const notice=state.content.querySelector('.bxl-reader-translation-status');notice.textContent=message('readerTranslationError');notice.hidden=false;
      return;
    }
    state.translation=payload.text;state.translated=true;
    state.content.querySelector('.bxl-reader-text').textContent=decode(payload.text);
    state.content.querySelector('.bxl-reader-translation-status').hidden=true;
    button.textContent=message('readerShowOriginal');
  }
  function update(state,post) {
    if(!activeContext() || current!==state)return;
    clearTimeout(state.timeout);state.status.hidden=true;
    if(!state.post){state.post=post;state.content.append(renderPost(post));}
    else if(!state.post.long || post.long){
      state.post=post;
      if(!state.translated)state.content.querySelector('.bxl-reader-text').textContent=decode(post.text);
    }
  }
  function open(id,handle,focus) {
    close();
    const dialog=element('dialog');dialog.id='bxl-tweet-dialog';dialog.setAttribute('aria-label',message('readerTitle'));theme(dialog);
    const header=element('header');
    const original=element('a',message('readerOriginal'),'bxl-reader-original');original.href=`${location.origin}/${handle}/status/${id}`;original.target='_blank';original.rel='noopener noreferrer';
    const dismiss=element('button','×','bxl-reader-close');dismiss.type='button';dismiss.setAttribute('aria-label',message('readerClose'));dismiss.addEventListener('click',()=>close());header.append(dismiss,original);
    const status=element('p',message('readerLoading'),'bxl-reader-status');status.setAttribute('role','status');
    const content=element('section',null,'bxl-reader-content');
    dialog.append(header,status,content);
    const state={id,token:crypto.randomUUID(),dialog,status,content,focus,x:window.scrollX,y:window.scrollY,route:location.pathname+location.search};current=state;
    document.documentElement.setAttribute('data-bxl-popup-open','');document.body.append(dialog);dialog.showModal();dismiss.focus({preventScroll:true});window.scrollTo({left:state.x,top:state.y,behavior:'instant'});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    let outside=false;
    const isOutside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',event=>{outside=event.target===dialog && isOutside(event);});
    dialog.addEventListener('click',event=>{if(outside&&event.target===dialog&&isOutside(event))close();outside=false;});
    const fail=(code='connection')=>{if(activeContext() && current===state){state.dialog.dataset.readerError=code;clearTimeout(state.timeout);status.hidden=false;status.textContent=message('readerError');}};
    try {
      state.send=payload=>document.dispatchEvent(new CustomEvent('bxl-reader-request',{detail:JSON.stringify({token:state.token,...payload})}));
      state.receive=event=>{
        if(!activeContext() || current!==state || typeof event.detail!=='string' || event.detail.length>2000000)return;
        let payload;try{payload=JSON.parse(event.detail);}catch{return;}
        if(!payload || payload.token!==state.token)return;
        if(payload.type==='data'){
          if(!Array.isArray(payload.posts) || payload.posts.length>500)return;
          for(const post of payload.posts){
            if(!post || post.id!==state.id || !/^[\w]{1,15}$/.test(post.handle) || typeof post.text!=='string' || post.text.length>50000)continue;
            update(state,post);
          }
        }else if(payload.type==='translation')translationResult(state,payload);
        else if(payload.type==='error')fail(payload.code);
      };
      document.addEventListener('bxl-reader-response',state.receive);
      state.timeout=setTimeout(fail,35000);
      state.send({type:'open',id});
    }catch{fail();}
  }
  document.addEventListener('click',event=>{
    if(!useGrid() || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || getSelection()?.toString())return;
    if(!(event.target instanceof Element))return;
    const article=event.target.closest('[data-bxl-grid] article[data-testid="tweet"]');if(!article)return;
    // X handles thumbnail/overlay clicks on the player wrapper, not just the
    // video or play button. Leave the whole player to its native controls.
    if(event.target.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"]'))return;
    const control=event.target.closest('button,[role="button"],input,textarea,video,[contenteditable="true"]');
    if(control && control!==article)return;
    const timestamp=article.querySelector('a[href*="/status/"] time')?.closest('a');
    const link=event.target.closest('a,[role="link"]');
    // Keep profiles, hashtags, media viewers, quotes and action links native.
    if(link && link!==timestamp)return;
    let url;try{url=new URL(timestamp?.href);}catch{return;}
    const match=url.pathname.match(/^\/([\w]{1,15})\/status\/(\d+)$/);
    if(!match || url.origin!==location.origin)return;
    event.preventDefault();event.stopImmediatePropagation();open(match[2],match[1],timestamp);
  },{capture:true,signal:lifetime.signal});
  try {
  chrome.storage.local.get({enabled:true,tweetPopup:false},settings=>{
    if(!activeContext() || chrome.runtime.lastError)return;enabled=settings.enabled!==false;popup=settings.tweetPopup===true;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(!activeContext() || area!=='local')return;
    if(changes.enabled)enabled=changes.enabled.newValue!==false;
    if(changes.tweetPopup)popup=changes.tweetPopup.newValue===true;
    if(!enabled || !popup)close();
  });
  }catch{activeContext();return;}
  routeObserver=new MutationObserver(()=>{if(current&&!useGrid())close(false);});
  routeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-bxl-active','data-bxl-path']});
  themeObserver=new MutationObserver(()=>{if(activeContext() && current)theme(current.dialog);});
  themeObserver.observe(document.body,{attributes:true,attributeFilter:['style','class']});
  addEventListener('popstate',()=>close(false),{signal:lifetime.signal});addEventListener('pagehide',()=>close(false),{signal:lifetime.signal});
})();
