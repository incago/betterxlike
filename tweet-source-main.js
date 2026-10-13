/* Read X posts in the current page. Session headers remain inside this
 * MAIN-world closure; only normalized post data crosses into the popup. */
(() => {
  'use strict';
  const nativeFetch=window.fetch;
  const requests=new WeakMap();
  let sessionHeaders=null;
  const features=Object.create(null);
  let definitions=null;
  let current=null;
  const allowedHeaders=new Set(['authorization','x-csrf-token','x-twitter-auth-type','x-twitter-active-user','x-twitter-client-language']);
  function endpoint(value) {
    try {
      const url=new URL(value,location.href);
      return url.origin===location.origin && /^\/i\/api\/graphql\/[\w-]+\/[\w]+$/.test(url.pathname) ? url : null;
    }catch{return null;}
  }
  function remember(request) {
    const headers=request.headers.filter(([name])=>allowedHeaders.has(name.toLowerCase()));
    if(headers.some(([name])=>name.toLowerCase()==='authorization') && headers.some(([name])=>name.toLowerCase()==='x-csrf-token'))sessionHeaders=headers;
    try {
      const values=JSON.parse(request.url.searchParams.get('features'));
      for(const [key,value] of Object.entries(values || {}))if(typeof value==='boolean')features[key]=value;
    }catch{}
  }
  const originalOpen=XMLHttpRequest.prototype.open;
  const originalHeader=XMLHttpRequest.prototype.setRequestHeader;
  const originalSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...args){
    requests.delete(this);
    const target=endpoint(url);
    if(target && String(method).toUpperCase()==='GET')requests.set(this,{url:target,headers:[]});
    return Reflect.apply(originalOpen,this,[method,url,...args]);
  };
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){
    requests.get(this)?.headers.push([name,value]);
    return Reflect.apply(originalHeader,this,[name,value]);
  };
  XMLHttpRequest.prototype.send=function(...args){
    const request=requests.get(this);if(request)remember(request);
    return Reflect.apply(originalSend,this,args);
  };
  window.fetch=function(input,...args){
    try {
      const url=endpoint(typeof input==='string' || input instanceof URL ? String(input) : input?.url);
      if(url){const request=new Request(input instanceof Request ? input : url.href,args[0]);if(request.method==='GET')remember({url,headers:[...request.headers]});}
    }catch{}
    return Reflect.apply(nativeFetch,this,[input,...args]);
  };
  const emit=(job,payload)=>{
    if(current===job)document.dispatchEvent(new CustomEvent('bxl-reader-response',{detail:JSON.stringify({token:job.token,...payload})}));
  };
  // Query IDs change with X releases. Read just the metadata of the public main
  // bundle already linked by this page, without evaluating downloaded code.
  async function loadDefinitions(signal) {
    if(definitions)return definitions;
    const src=[...document.scripts].map(script=>script.src).find(src=>/^https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.[\w]+\.js$/.test(src));
    if(!src)throw new Error('No query metadata');
    const response=await nativeFetch(src,{credentials:'omit',signal,redirect:'error'});
    if(!response.ok)throw new Error('No query metadata');
    const source=await response.text();
    const result={};
    for(const name of ['TweetResultByRestId']){
      const match=source.match(new RegExp('queryId:"([\\w-]+)",operationName:"'+name+'",operationType:"query",metadata:\\{featureSwitches:(\\[[^\\]]*\\]),fieldToggles:(\\[[^\\]]*\\])'));
      if(!match)throw new Error('No query metadata');
      result[name]={id:match[1],features:JSON.parse(match[2]),fields:JSON.parse(match[3])};
    }
    definitions=result;return result;
  }
  async function query(job,name) {
    const config=job.definitions[name];
    const url=new URL(`/i/api/graphql/${config.id}/${name}`,location.origin);
    const variables={tweetId:job.id,withCommunity:true,includePromotedContent:true,withVoice:true};
    const flags=Object.fromEntries(config.features.map(key=>[key,features[key] ?? false]));
    for(const key of ['longform_notetweets_consumption_enabled','longform_notetweets_rich_text_read_enabled','longform_notetweets_inline_media_enabled'])if(key in flags)flags[key]=true;
    url.searchParams.set('variables',JSON.stringify(variables));
    url.searchParams.set('features',JSON.stringify(flags));
    url.searchParams.set('fieldToggles',JSON.stringify(Object.fromEntries(config.fields.map(key=>[key,key==='withArticlePlainText']))));
    const response=await nativeFetch(url.href,{method:'GET',headers:sessionHeaders,credentials:'same-origin',signal:job.abort.signal,redirect:'error'});
    if(!response.ok)throw new Error('Read failed');
    const data=await response.json();
    if(data.errors?.length && !data.data)throw new Error('Read failed');
    const posts=BxlTweetData.collect(data).filter(post=>post.id===job.id);
    if(!posts.length)throw new Error('Post unavailable');
    for(let i=0;i<posts.length;i+=500)emit(job,{type:'data',posts:posts.slice(i,i+500)});
    return data;
  }
  async function load(job) {
    try {
      // X normally sends its timeline request before the grid can be clicked.
      for(let i=0;!sessionHeaders && i<50;i++){
        await new Promise(resolve=>setTimeout(resolve,100));
        if(current!==job)return;
      }
      if(!sessionHeaders)throw new Error('No session');
      job.definitions=await loadDefinitions(job.abort.signal);
      await query(job,'TweetResultByRestId');
    }catch{emit(job,{type:'error'});}
  }
  async function translate(job) {
    if(job.translating)return;
    if(job.translation){emit(job,{type:'translation',text:job.translation});return;}
    job.translating=true;
    const controller=new AbortController();
    const abort=()=>controller.abort();
    job.abort.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,20000);
    try {
      // Same read endpoint used by X's translation button. X chooses the target
      // language from its own x-twitter-client-language session header.
      const path=`/i/api/1.1/strato/column/None/tweetId=${job.id},destinationLanguage=None,translationSource=Some(X),feature=None,timeout=None,onlyCached=None/translation/service/translateTweet`;
      const response=await nativeFetch(new URL(path,location.origin).href,{method:'GET',headers:sessionHeaders,credentials:'same-origin',signal:controller.signal,redirect:'error'});
      if(!response.ok)throw new Error('Translation failed');
      const data=await response.json();
      if(typeof data.translation!=='string' || !data.translation.trim() || data.translation.length>50000)throw new Error('Translation unavailable');
      job.translation=data.translation;
      emit(job,{type:'translation',text:job.translation});
    }catch{emit(job,{type:'translation',error:true});}
    finally{clearTimeout(timeout);job.abort.signal.removeEventListener('abort',abort);job.translating=false;}
  }
  document.addEventListener('bxl-reader-request',event=>{
    if(typeof event.detail!=='string' || event.detail.length>1000)return;
    let message;try{message=JSON.parse(event.detail);}catch{return;}
    if(!message || typeof message!=='object')return;
    if(message.type==='close' && current?.token===message.token){current.abort.abort();current=null;return;}
    if(message.type==='translate' && current?.token===message.token){void translate(current);return;}
    if(message.type!=='open' || !/^\d{1,25}$/.test(message.id) || !/^[\w-]{1,80}$/.test(message.token))return;
    // Requests are only available while the extension's grid popup is mounted.
    if(!document.documentElement.hasAttribute('data-bxl-popup-open') || !document.getElementById('bxl-tweet-dialog'))return;
    current?.abort.abort();
    const job={id:message.id,token:message.token,abort:new AbortController(),translating:false,translation:null};current=job;
    void load(job);
  });
  addEventListener('pagehide',()=>{current?.abort.abort();current=null;sessionHeaders=null;});
})();
