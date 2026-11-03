import { articleHtml, validateDraft } from './article-format.mjs';

export class ArticleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const requireResult = result => {
  if (result.error) throw new ArticleError('Записът не беше завършен. Обнови списъка преди нов опит.', 503);
  return result.data;
};
const one = async query => requireResult(await query.maybeSingle());
const requireRow = row => { if (!row) throw new ArticleError('Записът е променен или не е достъпен. Обнови списъка.',409); return row; };
const checkDraft = input => { try { return validateDraft(input); } catch (error) { throw new ArticleError(error.message); } };
export const articleMarker = row => `<!-- ccc-article:${row.id}:revision:${row.revision} -->`;
export function matchesApprovedPost(post,row) {
  const expected=articleMarker(row)+'\n'+articleHtml(row.body_markdown,row.sources);
  return post.content?.raw?.trim()===expected.trim() && post.title?.raw===row.title &&
    (post.excerpt?.raw||'').trim()===row.excerpt.trim() &&
    (!row.wp_media_id || post.featured_media===row.wp_media_id) &&
    (!row.category_ids.length || JSON.stringify([...(post.categories||[])].sort())===JSON.stringify([...row.category_ids].sort()));
}

export function wordpressClient(site, username, password, fetcher = fetch) {
  if (site.site_url !== 'https://www.zabarcelona.com' || site.site_key !== 'zabarcelona') throw new ArticleError('Непознат сайт.',403);
  // Credentials are never sent across a redirect or to a URL supplied by the browser.
  const authorization = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(username + ':' + password)));
  async function request(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetcher(site.site_url + '/wp-json/wp/v2/' + path, {
      method, redirect:'error', signal:AbortSignal.timeout(25000),
      headers:{Authorization:authorization, ...(body instanceof Uint8Array ? {} : {'Content-Type':'application/json'}), ...extraHeaders},
      body:body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
    });
    if (!response.ok) throw new ArticleError(`WordPress отказа заявката (${response.status}). Провери достъпа и състоянието на статията.`,502);
    try { return await response.json(); } catch { throw new ArticleError('WordPress върна неясен отговор. Нужна е проверка.',502); }
  }
  return { request, async uploadImage(row) {
    const response = await fetcher(row.image_url, {redirect:'error',signal:AbortSignal.timeout(20000)});
    const mime = response.headers.get('content-type')?.split(';')[0];
    const limit = 5 * 1024 * 1024;
    if (!response.ok || !['image/jpeg','image/png','image/webp'].includes(mime) || Number(response.headers.get('content-length')) > limit) throw new ArticleError('Снимката не е достъпна или е над 5 MB.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length;
      if (size > limit) { await reader.cancel(); throw new ArticleError('Снимката е над 5 MB.'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    const png = [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
    const webp = new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
    if (!(mime==='image/jpeg'&&jpeg || mime==='image/png'&&png || mime==='image/webp'&&webp)) throw new ArticleError('Файлът не е валидна снимка.');
    const ext = mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp';
    const media = await request('media','POST',bytes,{'Content-Type':mime,'Content-Disposition':`attachment; filename="ccc-${row.id}.${ext}"`});
    if (!Number.isSafeInteger(media.id)) throw new ArticleError('Липсва потвърждение за снимката.',502);
    return media;
  }};
}

export async function publishApproved(row, save, wp) {
  // This function receives only a row already atomically claimed by its owner.
  if (row.status!=='publishing' || row.approved_revision!==row.revision || row.approved_by!==row.user_id || !row.approved_at) throw new ArticleError('Липсва одобрение за тази версия.',403);
  const draft = checkDraft(row), marker = articleMarker(row);
  try {
    if (draft.image_url && !row.wp_media_id) {
      const media = await wp.uploadImage(row);
      row = await save({wp_media_id:media.id});
      await wp.request('media/'+media.id,'POST',{alt_text:draft.image_alt});
    }
    if (!row.wp_post_id) {
      const created = await wp.request('posts','POST',{
        title:draft.title,content:marker+'\n'+articleHtml(draft.body_markdown,draft.sources),
        excerpt:draft.excerpt,slug:'ccc-'+row.id,status:'draft',
        ...(draft.category_ids.length?{categories:draft.category_ids}:{}),
        ...(row.wp_media_id?{featured_media:row.wp_media_id}:{})
      });
      if (!Number.isSafeInteger(created.id) || created.status!=='draft') throw new ArticleError('Неясен резултат при създаване на черновата.',502);
      row = await save({wp_post_id:created.id});
    }
    const existing = await wp.request('posts/'+row.wp_post_id+'?context=edit');
    if (!matchesApprovedPost(existing,row) || !['draft','publish'].includes(existing.status)) throw new ArticleError('Черновата в WordPress е променена. Нужен е преглед.',409);
    if (existing.status!=='publish') await wp.request('posts/'+row.wp_post_id,'POST',{
      status:'publish',slug:draft.slug || draft.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,150)
    });
    const confirmed = await wp.request('posts/'+row.wp_post_id+'?context=edit');
    if (confirmed.id!==row.wp_post_id || confirmed.status!=='publish' || !matchesApprovedPost(confirmed,row) || !confirmed.link?.startsWith('https://www.zabarcelona.com/')) throw new ArticleError('Публикуването още не е потвърдено.',502);
    return await save({status:'published',wp_url:confirmed.link,published_at:new Date().toISOString(),error_message:null});
  } catch (error) {
    // Never create a second post after a timeout or an uncertain database write.
    try { await save({status:'needs_review',error_message:'Публикуването не е потвърдено. Натисни „Провери в WordPress“; не създавай нова заявка.'}); } catch { /* A locked publishing row is deliberately not automatically retried. */ }
    throw new ArticleError(error instanceof ArticleError ? error.message : 'Връзката прекъсна. Провери резултата в WordPress преди нов опит.',502);
  }
}

export async function handleArticleAction({db,userId,body,env,fetcher=fetch}) {
  if (!body || typeof body.action!=='string') throw new ArticleError('Липсва действие.');
  let row,site;
  if (['status','queue'].includes(body.action)) {
    if (!uuid(body.brand_id)) throw new ArticleError('Избери бранд.');
    site = await one(db.from('article_sites').select('*').eq('brand_id',body.brand_id).eq('user_id',userId));
    if (!site) throw new ArticleError('Този бранд няма настроен сайт.',403);
  } else {
    if (!uuid(body.id)) throw new ArticleError('Невалидна статия.');
    row = requireRow(await one(db.from('article_requests').select('*').eq('id',body.id).eq('user_id',userId)));
    site = requireRow(await one(db.from('article_sites').select('*').eq('brand_id',row.brand_id).eq('user_id',userId)));
  }
  const configured = Boolean(env('WP_ZABARCELONA_USER') && env('WP_ZABARCELONA_APP_PASSWORD'));
  if (body.action==='status') {
    let categories=[];
    try {
      const response=await fetcher(site.site_url+'/wp-json/wp/v2/categories?per_page=100&_fields=id,name',{redirect:'error',signal:AbortSignal.timeout(8000)});
      const data=response.ok?await response.json():[];
      if(Array.isArray(data))categories=data.filter(c=>Number.isSafeInteger(c.id)&&typeof c.name==='string').map(c=>({id:c.id,name:c.name}));
    } catch { /* Category lookup must not prevent drafting while WordPress is unavailable. */ }
    return {configured,site_url:site.site_url,categories};
  }
  if (body.action==='queue') {
    if (!uuid(body.idea_id)) throw new ArticleError('Избери идея.');
    const idea = requireRow(await one(db.from('content_ideas').select('*').eq('id',body.idea_id).eq('brand_id',site.brand_id).eq('user_id',userId)));
    if (idea.tag==='Имоти' || idea.labels?.includes('rejected')) throw new ArticleError('Избери активна идея за ZaBarcelona.');
    const existing=await one(db.from('article_requests').select('*').eq('idea_id',idea.id).eq('brand_id',site.brand_id).eq('user_id',userId));
    if (existing) return {article:existing};
    const result=await db.from('article_requests').insert({user_id:userId,brand_id:site.brand_id,idea_id:idea.id,title:idea.title}).select().single();
    if (result.error?.code==='23505') return {article:requireRow(await one(db.from('article_requests').select('*').eq('idea_id',idea.id).eq('brand_id',site.brand_id).eq('user_id',userId)))};
    return {article:requireResult(result)};
  }
  const cas = changes => one(db.from('article_requests').update(changes).eq('id',row.id).eq('user_id',userId).eq('revision',row.revision).eq('status',row.status).select('*')).then(requireRow);
  if (body.action==='save') {
    if (row.status!=='draft_ready' || row.wp_post_id || row.revision!==body.revision) throw new ArticleError('Обнови статията, преди да я редактираш.',409);
    return {article:await cas({...checkDraft(body.draft),status:'draft_ready',error_message:null})};
  }
  if (body.action==='retry') {
    if (!['failed','cancelled'].includes(row.status) || row.wp_post_id || row.approved_at) throw new ArticleError('Тази заявка изисква преглед.',409);
    return {article:await cas({status:'queued',error_message:null})};
  }
  if (body.action==='cancel') {
    if (!['queued','draft_ready','failed'].includes(row.status) || row.wp_post_id || row.approved_at) throw new ArticleError('Заявката вече се обработва или изисква преглед.',409);
    return {article:await cas({status:'cancelled'})};
  }
  if (!['publish','reconcile'].includes(body.action)) throw new ArticleError('Непознато действие.');
  if (!configured) throw new ArticleError('Връзката с WordPress чака специалния ключ. Статията е запазена.',503);
  const wp=wordpressClient(site,env('WP_ZABARCELONA_USER'),env('WP_ZABARCELONA_APP_PASSWORD'),fetcher);
  if (body.action==='reconcile') {
    if (!['needs_review','publishing'].includes(row.status)) return {article:row};
    // Allow an in-flight request to finish before read-only reconciliation.
    if (row.status==='publishing' && Date.now()-Date.parse(row.updated_at)<180000) throw new ArticleError('Публикуването още се проверява. Изчакай до 3 минути.',409);
    const candidates=row.wp_post_id?[await wp.request('posts/'+row.wp_post_id+'?context=edit')]:await wp.request('posts?context=edit&status=draft,publish,pending,private,future&slug=ccc-'+row.id);
    if (!Array.isArray(candidates) || candidates.length!==1 || !matchesApprovedPost(candidates[0],row)) throw new ArticleError('Не може да се установи еднозначен резултат. Нужна е ръчна проверка в WordPress.',409);
    const post=candidates[0];
    if (!['publish','draft'].includes(post.status)) throw new ArticleError('Статусът в WordPress изисква ръчен преглед.',409);
    if (post.status==='publish' && !post.link?.startsWith(site.site_url+'/')) throw new ArticleError('Невалиден адрес от WordPress.',502);
    return {article:await cas({wp_post_id:post.id,status:post.status==='publish'?'published':'draft_ready',
      ...(post.status==='publish'?{wp_url:post.link,published_at:new Date().toISOString()}:{}),
      error_message:post.status==='draft'?'Намерена е черновата в WordPress. Можеш да одобриш публикуването отново.':null})};
  }
  if (row.status==='published') return {article:row};
  if (row.status!=='draft_ready' || row.revision!==body.revision || body.confirm!==true) throw new ArticleError('Прегледай актуалната версия и потвърди публикуването.',409);
  checkDraft(row);
  // Check the credentials before claiming the article or writing to WordPress.
  const wpUser=await wp.request('users/me?context=edit');
  if (!wpUser.capabilities?.publish_posts || !wpUser.capabilities?.edit_posts || (row.image_url&&!wpUser.capabilities?.upload_files)) throw new ArticleError('WordPress потребителят няма нужните права.',403);
  row=await cas({status:'publishing',approved_revision:row.revision,approved_by:userId,approved_at:new Date().toISOString(),error_message:null});
  const save=async changes => { row=requireRow(await one(db.from('article_requests').update(changes).eq('id',row.id).eq('user_id',userId).eq('status','publishing').eq('revision',row.revision).select('*'))); return row; };
  return {article:await publishApproved(row,save,wp)};
}
