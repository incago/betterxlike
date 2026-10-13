const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');
const context=vm.createContext({});vm.runInContext(fs.readFileSync('tweet-data.js','utf8'),context);
const adapter=context.BxlTweetData;
function tweet(id,replyTo,note){return {__typename:'Tweet',rest_id:id,legacy:{full_text:'short <script> &amp;',in_reply_to_status_id_str:replyTo},core:{user_results:{result:{core:{screen_name:'writer',name:'Writer'}}}},...(note?{note_tweet:{note_tweet_results:{result:{text:note}}}}:{})};}
test('long note text survives normalization and unavailable tweets are skipped',()=>{
 const long='긴 본문 '.repeat(1500);
 const result=adapter.collect({data:{main:tweet('1',null,long),deleted:{__typename:'TweetTombstone'},other:tweet('2','1')}});
 assert.equal(result.length,2);assert.equal(result.find(p=>p.id==='1').text,long);
 assert.equal(result.find(p=>p.id==='1').long,true);
});
test('normalizer supports legacy users, visibility wrappers and highest bitrate mp4',()=>{
 const t=tweet('1');t.core.user_results.result={legacy:{screen_name:'old',name:'Old'}};
 t.legacy.extended_entities={media:[{type:'video',media_url_https:'https://pbs.twimg.com/post.jpg',video_info:{variants:[{content_type:'application/x-mpegURL',url:'hls'},{content_type:'video/mp4',bitrate:100,url:'low'},{content_type:'video/mp4',bitrate:500,url:'high'}]}}]};
 const result=adapter.normalize({tweet:t});assert.equal(result.handle,'old');assert.equal(result.media[0].video,'high');
 assert.equal(adapter.normalize({...t,rest_id:'bad-id'}),null);
});

test('quoted posts retain full text without recursively copying a quote chain',()=>{
 const t=tweet('1');t.quoted_status_result={result:tweet('2',null,'Full quoted text')};
 t.quoted_status_result.result.quoted_status_result={result:tweet('3')};
 const result=adapter.normalize(t);assert.equal(result.quote.text,'Full quoted text');assert.equal(result.quote.quote,null);
});
