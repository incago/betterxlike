/* Pure adapter for X's native post responses. Never handles credentials. */
(() => {
  'use strict';
  function normalize(result, includeQuote = true) {
    const t = result?.tweet || result;
    if (!/^\d+$/.test(t?.rest_id || '') || !t.legacy) return null;
    const legacy = t.legacy;
    const user = t.core?.user_results?.result;
    const handle = user?.core?.screen_name || user?.legacy?.screen_name;
    if (!/^[\w]{1,15}$/.test(handle || '')) return null;
    const note = t.note_tweet?.note_tweet_results?.result;
    const text = note?.text || legacy.full_text;
    if (typeof text !== 'string') return null;
    const media = (legacy.extended_entities?.media || []).map(m => ({
      type: m.type, url: m.media_url_https,
      video: m.video_info?.variants?.filter(v => v.content_type === 'video/mp4')
        .sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url,
      alt: m.ext_alt_text || ''
    }));
    return {id:t.rest_id, handle, name:user.core?.name || user.legacy?.name || handle,
      text, lang:legacy.lang || '', long: Boolean(note?.text), replyTo:legacy.in_reply_to_status_id_str || null,
      createdAt:legacy.created_at || '', media,
      avatar:user.avatar?.image_url || user.legacy?.profile_image_url_https || '',
      replyCount:legacy.reply_count || 0,
      quote: includeQuote ? normalize(t.quoted_status_result?.result, false) : null};
  }
  function collect(data) {
    const posts = new Map(); const stack = [data]; let visited = 0;
    while (stack.length && visited++ < 50000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      if (value.__typename === 'Tweet') {
        const post = normalize(value); if (post) posts.set(post.id, post);
      }
      stack.push(...Object.values(value).filter(v => v && typeof v === 'object'));
    }
    return [...posts.values()].reverse();
  }
  globalThis.BxlTweetData = Object.freeze({normalize, collect});
})();
