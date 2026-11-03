import { createClient } from 'npm:@supabase/supabase-js@2.105.0';
import { handleArticleAction, ArticleError } from '../../../article-service.mjs';

const allowedOrigins = new Set(['https://ledatrif.github.io']);
Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const cors = {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://ledatrif.github.io',
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin'
  };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}
  });
  if (origin && !allowedOrigins.has(origin)) return reply({error:'Непознат адрес на приложението.'},403);
  if (req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if (req.method!=='POST') return reply({error:'Неподдържан метод.'},405);
  try {
    const authorization=req.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return reply({error:'Влез в профила си.'},401);
    const keyMap=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const key=keyMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) return reply({error:'Сървърната връзка не е настроена.'},503);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await db.auth.getUser(authorization.slice(7));
    if (error || !data.user) return reply({error:'Сесията е изтекла. Влез отново.'},401);
    const text=await req.text();
    if (text.length>150000) return reply({error:'Статията е прекалено дълга.'},413);
    let body; try { body=JSON.parse(text); } catch { return reply({error:'Невалидна заявка.'},400); }
    return reply(await handleArticleAction({db,userId:data.user.id,body,env:(name:string)=>Deno.env.get(name)}));
  } catch (error) {
    // Never expose headers, credentials, raw WordPress errors or request bodies.
    return reply({error:error instanceof ArticleError ? error.message : 'Заявката не завърши. Обнови статуса преди нов опит.'},error instanceof ArticleError ? error.status : 500);
  }
});
