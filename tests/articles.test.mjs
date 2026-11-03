import test from 'node:test';
import assert from 'node:assert/strict';
import {articleHtml,validateDraft,validImageUrl,safeUrl} from '../article-format.mjs';
import {publishApproved,articleMarker,wordpressClient,matchesApprovedPost,handleArticleAction} from '../article-service.mjs';

const draft=()=>({id:'11111111-1111-4111-8111-111111111111',user_id:'owner',title:'Разходка в Барселона',body_markdown:'## Маршрут\n\nТекст с **детайли**.',excerpt:'Кратко резюме',slug:'razhodka',image_url:'',image_alt:'',category_ids:[],sources:[],revision:2,status:'publishing',approved_revision:2,approved_by:'owner',approved_at:'2026-11-03T12:00:00Z',wp_post_id:null,wp_media_id:null});
function scenario({fault,existing,tamper=false,failSave=false}={}) {
  let row=draft(),post=existing?structuredClone(existing):null,calls=[];
  if(existing)row.wp_post_id=existing.id;
  const save=async changes=>{calls.push(['save',changes]);if(failSave&&changes.wp_post_id)throw new Error('db timeout');row={...row,...changes};return {...row};};
  const wp={async request(path,method='GET',body){
    calls.push([method,path,body]);
    if(path==='posts'&&method==='POST'){
      post={id:42,status:'draft',content:{raw:body.content},title:{raw:body.title},excerpt:{raw:body.excerpt},categories:[1],featured_media:0,link:'https://www.zabarcelona.com/razhodka/'};
      if(fault==='create')throw new Error('timeout after server created post');
      return {...post};
    }
    if(method==='POST'){post.status='publish';if(fault==='publish')throw new Error('timeout after publishing');return {...post};}
    if(tamper)post.content.raw+='\n<p>Unapproved text</p>';
    return structuredClone(post);
  }};
  return {run:()=>publishApproved({...row},save,wp),calls,get row(){return row;},get post(){return post;}};
}
test('HTML is inert; only safe links and supported formatting render',()=>{
  const html=articleHtml('<script>alert(1)</script>\n\n## Heading\n\n- **Bold**\n- [safe](https://example.com)\n- [bad](javascript:alert(1))');
  assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(html.includes('<h2>Heading</h2>'));assert(html.includes('<strong>Bold</strong>'));
  assert.equal(safeUrl('https://user:password@example.com'),'');
});
test('image fetch allowlist blocks arbitrary hosts, local networks, credentials and SVG',()=>{
  for(const url of ['http://127.0.0.1/a.jpg','https://evil.com/a.jpg','https://ledatrif.github.io.evil.com/content-command-center/media/a.jpg','https://user@www.zabarcelona.com/wp-content/uploads/a.jpg','https://www.zabarcelona.com/wp-content/uploads/a.svg','https://www.zabarcelona.com:444/wp-content/uploads/a.jpg'])assert.equal(validImageUrl(url),false,url);
  assert(validImageUrl('https://ledatrif.github.io/content-command-center/media/posts/a.jpg'));
});
test('draft validation refuses invalid fields and sources',()=>{
  assert.throws(()=>validateDraft({...draft(),sources:[{title:'x',url:'javascript:alert(1)'}]}));
  assert.throws(()=>validateDraft({...draft(),title:''}));
  assert.throws(()=>validateDraft({...draft(),image_url:'https://www.zabarcelona.com/wp-content/uploads/a.jpg',image_alt:''}));
  assert.throws(()=>validateDraft({...draft(),category_ids:[-1]}));
});
test('publication requires approval of this exact revision by its owner',async()=>{
  for(const changes of [{approved_revision:1},{approved_by:'other'},{approved_at:null},{status:'draft_ready'}]){
    await assert.rejects(()=>publishApproved({...draft(),...changes},()=>assert.fail(),{request:()=>assert.fail()}));
  }
});
test('draft ID is saved before publish; published status requires readback',async()=>{
  const s=scenario();const result=await s.run();assert.equal(result.status,'published');assert.equal(result.wp_post_id,42);
  const stored=s.calls.findIndex(c=>c[0]==='save'&&c[1].wp_post_id===42),publish=s.calls.findIndex(c=>c[0]==='POST'&&c[1]==='posts/42');assert(stored<publish);
  assert.equal(s.calls.filter(c=>c[0]==='POST'&&c[1]==='posts').length,1);
  assert.equal(s.calls.at(-2)[0],'GET');
});
test('ambiguous create stops without a second create or publish',async()=>{
  const s=scenario({fault:'create'});await assert.rejects(s.run);assert.equal(s.row.status,'needs_review');assert.equal(s.post.status,'draft');assert.equal(s.calls.filter(c=>c[0]==='POST').length,1);
});
test('ambiguous publish stays unconfirmed for reconciliation',async()=>{
  const s=scenario({fault:'publish'});await assert.rejects(s.run);assert.equal(s.row.status,'needs_review');assert.equal(s.row.wp_post_id,42);assert.equal(s.post.status,'publish');
});
test('failed persistence of a created ID prevents publish',async()=>{
  const s=scenario({failSave:true});await assert.rejects(s.run);assert.equal(s.post.status,'draft');assert.equal(s.calls.filter(c=>c[0]==='POST').length,1);
});
test('a WordPress edit after approval cannot be silently published',async()=>{
  const s=scenario({tamper:true});await assert.rejects(s.run);assert.equal(s.post.status,'draft');assert.equal(s.row.status,'needs_review');
});
test('resuming an identified draft never creates another post',async()=>{
  const r=draft(),existing={id:42,status:'draft',content:{raw:articleMarker(r)+'\n'+articleHtml(r.body_markdown,r.sources)},title:{raw:r.title},excerpt:{raw:r.excerpt},categories:[1],link:'https://www.zabarcelona.com/razhodka/'};
  assert(matchesApprovedPost(existing,r));const s=scenario({existing});await s.run();assert(!s.calls.some(c=>c[0]==='POST'&&c[1]==='posts'));
});
test('WordPress credentials stay on the fixed HTTPS origin and redirects are refused',async()=>{
  let sent;const wp=wordpressClient({site_key:'zabarcelona',site_url:'https://www.zabarcelona.com'},'test-user','test-password',async(url,opts)=>{sent={url,opts};return Response.json({id:1});});
  await wp.request('users/me');assert.equal(sent.url,'https://www.zabarcelona.com/wp-json/wp/v2/users/me');assert.equal(sent.opts.redirect,'error');
  assert.throws(()=>wordpressClient({site_key:'zabarcelona',site_url:'https://evil.com'},'x','y'));
});
test('service rejects access to another owner before any WordPress request',async()=>{
  const filters=[];const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){return {data:null,error:null};}};
  await assert.rejects(()=>handleArticleAction({db:{from:()=>query},userId:'owner',body:{action:'publish',id:draft().id,revision:2,confirm:true},env:()=> 'secret',fetcher:()=>assert.fail()}));
  assert(filters.some(([k,v])=>k==='user_id'&&v==='owner'));
});

function serviceFixture({configured=true}={}) {
  const row={...draft(),status:'draft_ready',approved_at:null,approved_by:null,approved_revision:null,brand_id:'22222222-2222-4222-8222-222222222222'};
  const site={brand_id:row.brand_id,user_id:row.user_id,site_key:'zabarcelona',site_url:'https://www.zabarcelona.com'};
  let post=null,creates=0,writes=0;
  const db={from(table){let changes=null,filters=[];const query={select(){return query},eq(k,v){filters.push([k,v]);return query},update(value){changes=value;return query},async maybeSingle(){
    const current=table==='article_sites'?site:row;
    if(!filters.every(([k,v])=>current[k]===v))return {data:null,error:null};
    if(changes){writes++;Object.assign(current,changes);}
    return {data:structuredClone(current),error:null};
  }};return query;}};
  const fetcher=async(url,opts)=>{
    if(url.includes('users/me'))return Response.json({capabilities:{publish_posts:true,edit_posts:true}});
    if(opts.method==='POST'&&url.endsWith('/posts')){
      creates++;const body=JSON.parse(opts.body);post={id:42,status:'draft',title:{raw:body.title},content:{raw:body.content},excerpt:{raw:body.excerpt},link:site.site_url+'/article/',categories:[1],featured_media:0};
    }else if(opts.method==='POST')post.status='publish';
    return Response.json(post);
  };
  return {row,get creates(){return creates},get writes(){return writes},run:body=>handleArticleAction({db,userId:'owner',body,env:()=>configured?'test-only-secret':undefined,fetcher})};
}
test('two concurrent approvals can claim and create only one WordPress post',async()=>{
  const s=serviceFixture(),body={action:'publish',id:s.row.id,revision:2,confirm:true};
  const results=await Promise.allSettled([s.run(body),s.run(body)]);
  assert.equal(s.creates,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.row.status,'published');
});
test('missing credentials do not claim the article or record approval',async()=>{
  const s=serviceFixture({configured:false});await assert.rejects(()=>s.run({action:'publish',id:s.row.id,revision:2,confirm:true}));assert.equal(s.writes,0);assert.equal(s.creates,0);
});
test('stale version or absent explicit confirmation cannot publish',async()=>{
  for(const input of [{revision:1,confirm:true},{revision:2,confirm:false}]){
    const s=serviceFixture();await assert.rejects(()=>s.run({action:'publish',id:s.row.id,...input}));assert.equal(s.writes,0);assert.equal(s.creates,0);
  }
});
