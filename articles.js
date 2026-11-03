import {articleHtml,escapeHtml,safeUrl,validImageUrl} from './article-format.mjs';

const $=s=>document.querySelector(s), context=()=>window.cccArticleContext();
const labels={queued:'Чака подготовка',processing:'Подготвя се',draft_ready:'За твоя преглед',publishing:'Публикува се',published:'Публикувана',failed:'Нужна е поправка',needs_review:'Провери в WordPress',cancelled:'Отказана'};
let sites=[],rows=[],loadedUser=null,loadingSites=null,editor=null,configured=false,busy=false,loadVersion=0,categories=[];
const listDialog=$('#articlesDialog'),editorDialog=$('#articleEditorDialog');
const message=(text,error=false)=>{const el=$('#articlesMessage');el.textContent=text;el.classList.toggle('article-error',error);};

async function api(action,payload={}) {
  const {db}=context();
  const {data,error}=await db.functions.invoke('article-publisher',{body:{action,...payload}});
  if(error){let detail;try{detail=await error.context?.json()}catch{}throw new Error(detail?.error||'Връзката прекъсна. Обнови списъка преди нов опит.');}
  if(data?.error)throw new Error(data.error);
  return data;
}
function activeSite(){const c=context();return sites.find(s=>s.brand_id===c.brand?.id&&s.user_id===c.userId);}
async function syncContext(){
  const c=context();
  if(loadedUser!==c.userId){
    sites=[];rows=[];loadedUser=c.userId;loadingSites=null;++loadVersion;
    if(editorDialog.open)editorDialog.close();if(listDialog.open)listDialog.close();editor=null;
  }
  if(c.userId&&!loadingSites){
    const userId=c.userId;
    loadingSites=c.db.from('article_sites').select('brand_id,user_id,site_url').then(result=>{
      if(context().userId!==userId)return;
      if(result.error){loadingSites=null;return;}
      sites=result.data||[];decorate();
    });
  }
  decorate();
}
function decorate(){
  const enabled=Boolean(activeSite());
  $('#openArticlesBtn').hidden=!enabled;
  document.querySelectorAll('[data-article-idea]').forEach(b=>b.remove());
  if(!enabled)return;
  document.querySelectorAll('[data-create-post]').forEach(button=>{
    const id=button.dataset.createPost,idea=context().ideas.find(i=>i.id===id);
    if(!idea||idea.tag==='Имоти'||idea.labels?.includes('rejected'))return;
    const b=document.createElement('button');b.type='button';b.dataset.articleIdea=id;b.textContent='Подготви статия';
    b.onclick=()=>queue(id,b);button.after(b);
  });
}
async function queue(id,button){
  const c=context(),brandId=c.brand?.id;if(!brandId)return;
  if(button)button.disabled=true;
  try{await api('queue',{brand_id:brandId,idea_id:id});await openList();message('Заявката е записана. Статията ще чака твоя преглед след подготовката.');}
  catch(e){await openList();message(e.message,true);}
  finally{if(button)button.disabled=false;}
}
async function openList(){
  if(!activeSite())return;
  if(!listDialog.open)listDialog.showModal();
  await loadList();
}
async function loadList(){
  const c=context(),brandId=c.brand?.id,userId=c.userId,version=++loadVersion;
  message('Зареждам статиите…');$('#articleRefreshBtn').disabled=true;
  try{
    const [result,status]=await Promise.all([
      c.db.from('article_requests').select('*').eq('brand_id',brandId).eq('user_id',userId).order('created_at',{ascending:false}).limit(100),
      api('status',{brand_id:brandId})
    ]);
    if(version!==loadVersion||context().brand?.id!==brandId||context().userId!==userId)return;
    if(result.error)throw new Error('Не успях да заредя статиите.');
    rows=result.data||[];configured=status.configured;categories=status.categories||[];
    $('#articleConnection').textContent=configured?'Връзката към WordPress е настроена. Достъпът се проверява преди публикуване.':'Можеш да подготвяш и редактираш статии. Публикуването чака специалния ключ към WordPress.';
    const options=c.ideas.filter(i=>i.tag!=='Имоти'&&!i.labels?.includes('rejected')&&!rows.some(r=>r.idea_id===i.id));
    $('#articleIdeaSelect').innerHTML='<option value="">Избери идея за статия</option>'+options.map(i=>`<option value="${escapeHtml(i.id)}">${escapeHtml(i.title)}</option>`).join('');
    $('#articleList').innerHTML=rows.length?rows.map(r=>`<article class="article-row"><div><span class="article-status">${labels[r.status]||'За проверка'}</span><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(new Date(r.created_at).toLocaleString('bg-BG',{timeZone:'Europe/Madrid'}))} · версия ${r.revision}</p>${r.error_message?`<p class="article-error">${escapeHtml(r.error_message)}</p>`:''}</div><div class="article-row-actions"><button type="button" data-open-article="${r.id}">Преглед</button>${r.status==='published'&&safeUrl(r.wp_url)?`<a href="${escapeHtml(r.wp_url)}" target="_blank" rel="noopener">Виж в сайта ↗</a>`:''}</div></article>`).join(''):'<p class="empty-small">Тук ще се появят твоите статии. Избери идея и натисни „Подготви статия“.</p>';
    document.querySelectorAll('[data-open-article]').forEach(b=>b.onclick=()=>openEditor(rows.find(r=>r.id===b.dataset.openArticle)));
    message(rows.length===100?'Показани са последните 100 статии.':'Подготовка → твой преглед → одобрение → публикуване в сайта.');
  }catch(e){message(e.message,true);}
  finally{$('#articleRefreshBtn').disabled=false;}
}
function formDraft(){
  const f=$('#articleEditorForm').elements;
  return {title:f.title.value,body_markdown:f.body_markdown.value,excerpt:f.excerpt.value,slug:f.slug.value,image_url:f.image_url.value,image_alt:f.image_alt.value,
    category_ids:[...f.category_ids.selectedOptions].map(o=>Number(o.value)).filter(Boolean),
    sources:f.sources.value.split('\n').map(x=>x.trim()).filter(Boolean).map(url=>({title:url,url}))};
}
function editable(){return editor?.status==='draft_ready'&&!editor.wp_post_id;}
function dirty(){return JSON.stringify(formDraft())!==$('#articleEditorForm').dataset.saved;}
function updateControls(){
  const changed=dirty();
  $('#articleSaveBtn').disabled=busy||!editable()||!changed;
  $('#articlePublishBtn').disabled=busy||!configured||editor?.status!=='draft_ready'||changed;
  $('#articlePublishBtn').hidden=editor?.status==='published';
  $('#articleReconcileBtn').hidden=!['publishing','needs_review'].includes(editor?.status);
  $('#articleRetryBtn').hidden=!['failed','cancelled'].includes(editor?.status)||Boolean(editor?.wp_post_id||editor?.approved_at);
  $('#articleCancelBtn').hidden=!['queued','draft_ready','failed'].includes(editor?.status)||Boolean(editor?.wp_post_id||editor?.approved_at);
  for(const id of ['articleReconcileBtn','articleRetryBtn','articleCancelBtn'])$('#'+id).disabled=busy;
  $('#articleEditorNote').textContent=changed?'Има незапазени промени. Запази ги преди публикуване.':editor?.status==='published'?'Статията е публикувана.':!configured?'Публикуването чака специалния ключ към WordPress.':editor?.status==='draft_ready'?'Провери текста, източниците и снимката. Бутонът публикува тази версия в zabarcelona.com.':labels[editor?.status]||'';
}
function preview(){
  const d=formDraft();
  $('#articlePreview').innerHTML=`<h1>${escapeHtml(d.title)}</h1>${d.image_url&&validImageUrl(d.image_url)?`<img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.image_alt)}" referrerpolicy="no-referrer">`:''}${articleHtml(d.body_markdown,d.sources)}`;
  updateControls();
}
function openEditor(row){
  editor=row;const f=$('#articleEditorForm').elements;
  for(const key of ['title','body_markdown','excerpt','slug','image_url','image_alt'])f[key].value=row[key]||'';
  const known=[...categories];for(const id of row.category_ids||[])if(!known.some(c=>c.id===id))known.push({id,name:'Избрана категория '+id});
  f.category_ids.innerHTML=known.map(c=>`<option value="${c.id}" ${(row.category_ids||[]).includes(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  f.sources.value=(row.sources||[]).map(s=>s.url).join('\n');
  $('#articleEditorForm').dataset.saved=JSON.stringify(formDraft());
  $('#articleEditorFields').disabled=!editable();$('#articleEditorError').textContent=row.error_message||'';
  $('#articleEditorTitle').textContent='Статия · '+labels[row.status];
  const link=$('#articlePublishedLink');link.hidden=row.status!=='published'||!safeUrl(row.wp_url);if(!link.hidden)link.href=row.wp_url;
  preview();if(!editorDialog.open)editorDialog.showModal();
}
async function editorAction(action){
  if(!editor||busy)return;
  if(action==='publish'&&!window.confirm('Одобряваш ли версия '+editor.revision+' на „'+editor.title+'“ за публикуване сега в zabarcelona.com?'))return;
  busy=true;updateControls();$('#articleEditorError').textContent='';
  try{
    const data=await api(action,{id:editor.id,revision:editor.revision,...(action==='save'?{draft:formDraft()}:{}),...(action==='publish'?{confirm:true}:{})});
    openEditor(data.article);await loadList();
  }catch(e){
    $('#articleEditorError').textContent=e.message;
    // Read after an ambiguous response. Preserve unsaved edits on save failures.
    if(action!=='save'){
      const result=await context().db.from('article_requests').select('*').eq('id',editor.id).maybeSingle();
      if(result.data)openEditor(result.data);
      $('#articleEditorError').textContent=e.message;
    }
  }finally{busy=false;updateControls();}
}
$('#openArticlesBtn').onclick=openList;$('#articleRefreshBtn').onclick=loadList;
$('#articleQueueForm').onsubmit=e=>{e.preventDefault();const id=$('#articleIdeaSelect').value;if(id)queue(id,$('#articleQueueBtn'));};
$('#articleEditorForm').onsubmit=e=>{e.preventDefault();editorAction('save');};
$('#articleEditorForm').oninput=preview;
for(const [id,action] of [['articlePublishBtn','publish'],['articleReconcileBtn','reconcile'],['articleRetryBtn','retry'],['articleCancelBtn','cancel']])$('#'+id).onclick=()=>editorAction(action);
function closeEditor(){if(busy)return;if(dirty()&&!window.confirm('Да затворя ли без запазване на промените?'))return;editorDialog.close();}
$('#articleEditorClose').onclick=closeEditor;editorDialog.addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('#articlesClose').onclick=()=>listDialog.close();
window.addEventListener('ccc:render',syncContext);
setInterval(()=>{if(listDialog.open&&!editorDialog.open&&!document.hidden)loadList();},60000);
syncContext();
