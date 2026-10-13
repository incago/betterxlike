const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const tick=()=>new Promise(setImmediate);
const post=id=>({__typename:'Tweet',rest_id:id,legacy:{full_text:'post',in_reply_to_status_id_str:id==='123'?null:'123'},core:{user_results:{result:{core:{screen_name:'writer',name:'Writer'}}}}});
const response=(id,cursor)=>({data:{tweet:post(id),cursor:cursor?{cursorType:'Bottom',value:cursor}:null}});
function setup(){
 const dom=new JSDOM('<html data-bxl-popup-open><head><script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script></head><body><dialog id="bxl-tweet-dialog"></dialog></body></html>',{url:'https://x.com/home',runScripts:'outside-only'});const w=dom.window;
 class XHR {open(){}setRequestHeader(){}send(){}}
 const calls=[],events=[];let translation={translation:'번역된 본문'},root=response('123'),pause=null;
 w.XMLHttpRequest=XHR;w.Request=global.Request;
 w.fetch=async(url,options)=>{
  calls.push({url:String(url),options});
  if(String(url).startsWith('https://abs.twimg.com/'))return {ok:true,text:async()=>['TweetDetail','TweetResultByRestId'].map(name=>'queryId:"current-'+name+'",operationName:"'+name+'",operationType:"query",metadata:{featureSwitches:["known_feature","longform_notetweets_consumption_enabled"],fieldToggles:["withArticlePlainText"]}').join('')};
  const value=String(url).includes('/translation/service/translateTweet')?translation:root;
  if(pause)await pause;
  return {ok:true,json:async()=>value};
 };
 w.document.addEventListener('bxl-reader-response',e=>events.push(JSON.parse(e.detail)));
 w.eval(fs.readFileSync('tweet-data.js','utf8'));w.eval(fs.readFileSync('tweet-source-main.js','utf8'));
 const send=message=>w.document.dispatchEvent(new w.CustomEvent('bxl-reader-request',{detail:JSON.stringify({token:'test',...message})}));
 const session=(url='https://x.com/i/api/graphql/hash/HomeTimeline?features=%7B%22known_feature%22%3Atrue%7D',method='GET')=>{
  const x=new w.XMLHttpRequest();x.open(method,url);x.setRequestHeader('Authorization','test-only-token');x.setRequestHeader('x-csrf-token','test-only-csrf');x.setRequestHeader('x-client-transaction-id','do-not-replay');x.send();
 };
 return {w,calls,events,send,session,setTranslation:value=>translation=value,setRoot:value=>root=value,setPause:value=>pause=value,close:()=>w.close()};
}
test('cold grid start fetches only the focal post and never fetches replies',async t=>{
 const p=setup();t.after(p.close);p.session();p.setRoot({data:{tweet:post('123'),reply:post('456')}});p.send({type:'open',id:'123'});await tick();
 assert.equal(p.calls.length,2);assert.equal(p.calls[0].options.credentials,'omit');assert.equal(p.calls[0].options.headers,undefined);
 const call=p.calls[1],url=new URL(call.url);assert.equal(url.origin,'https://x.com');assert.match(url.pathname,/current-TweetResultByRestId/);
 assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.headers.length,2);
 assert.deepEqual(JSON.parse(url.searchParams.get('features')),{known_feature:true,longform_notetweets_consumption_enabled:true});
 assert.deepEqual(p.events.flatMap(e=>e.posts||[]).map(p=>p.id),['123']);
 assert.equal(JSON.stringify(p.events).includes('test-only'),false);assert.equal(p.w.location.href,'https://x.com/home');
 p.send({type:'more'});await tick();assert.equal(p.calls.length,2);
});
test('close aborts pending reads and ignores stale results when a new popup opens',async t=>{
 const p=setup();t.after(p.close);p.session();let resume;p.setPause(new Promise(resolve=>resume=resolve));
 p.send({type:'open',id:'123'});await tick();const old=p.calls.slice(1);p.send({type:'close'});
 assert.ok(old.every(call=>call.options.signal.aborted));const count=p.events.length;
 resume();await tick();assert.equal(p.events.length,count);
 p.setPause(null);p.send({type:'open',id:'123',token:'next'});await tick();assert.ok(p.events.slice(count).every(e=>e.token==='next'));
});
test('translation uses X only on demand, retries failure, serializes calls and caches the result',async t=>{
 const p=setup();t.after(p.close);p.session();
 p.send({type:'open',id:'https://other.example'});await tick();assert.equal(p.calls.length,0);
 p.send({type:'open',id:'123'});await tick();assert.equal(p.calls.length,2);
 p.setTranslation({errors:[{message:'unavailable'}]});p.send({type:'translate'});p.send({type:'translate'});await tick();
 assert.equal(p.calls.length,3);assert.equal(p.events.at(-1).error,true);
 const url=new URL(p.calls[2].url);assert.equal(url.origin,'https://x.com');assert.match(url.pathname,/tweetId=123,.*translationSource=Some\(X\).*translateTweet$/);
 p.setTranslation({translation:'번역된 본문'});p.send({type:'translate'});await tick();assert.equal(p.events.at(-1).text,'번역된 본문');
 p.send({type:'translate'});await tick();assert.equal(p.calls.length,4);assert.equal(JSON.stringify(p.events).includes('test-only'),false);
});
test('missing focal post produces an error even when the response contains other posts',async t=>{
 const p=setup();t.after(p.close);p.session();p.setRoot(response('456'));p.send({type:'open',id:'123'});await tick();assert.equal(p.events.at(-1).type,'error');
});
test('cross-origin and write requests cannot replace same-page session headers',async t=>{
 const p=setup();t.after(p.close);p.session();
 const x=new p.w.XMLHttpRequest();x.open('GET','https://other.example/i/api/graphql/hash/HomeTimeline');x.setRequestHeader('Authorization','foreign');x.setRequestHeader('x-csrf-token','foreign');x.send();
 const y=new p.w.XMLHttpRequest();y.open('POST','https://x.com/i/api/graphql/hash/CreateTweet');y.setRequestHeader('Authorization','write');y.setRequestHeader('x-csrf-token','write');y.send();
 p.send({type:'open',id:'123'});await tick();assert.equal(p.calls[1].options.headers[0][1],'test-only-token');
});
test('the packaged extension has no background or tab-creation transport',()=>{
 const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));assert.equal(manifest.background,undefined);
 assert.deepEqual(manifest.permissions,['storage']);
 for(const entry of manifest.content_scripts)for(const file of entry.js){
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/chrome\.tabs\.create|window\.open\(/);
 }
});
