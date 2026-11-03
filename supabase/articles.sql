-- Additive setup. Browser clients can read their rows; all writes go through
-- article-publisher (verified user) or the trusted article preparation worker.
create table public.article_sites (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  site_key text not null check (site_key = 'zabarcelona'),
  site_url text not null check (site_url = 'https://www.zabarcelona.com'),
  created_at timestamptz not null default now()
);
alter table public.article_sites enable row level security;
revoke all on public.article_sites from anon, authenticated;
grant select on public.article_sites to authenticated;
grant all on public.article_sites to service_role;
create policy article_sites_read_own on public.article_sites for select to authenticated
  using (user_id = (select auth.uid()));
create index article_sites_user_idx on public.article_sites(user_id);

create table public.article_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.article_sites(brand_id),
  idea_id uuid not null references public.content_ideas(id),
  status text not null default 'queued' check (status in
    ('queued','processing','draft_ready','publishing','published','failed','needs_review','cancelled')),
  title text not null default '',
  body_markdown text not null default '',
  excerpt text not null default '',
  slug text not null default '',
  image_url text not null default '',
  image_alt text not null default '',
  category_ids integer[] not null default '{}',
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  revision integer not null default 1 check (revision > 0),
  approved_revision integer,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  wp_post_id bigint,
  wp_media_id bigint,
  wp_url text,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,brand_id,idea_id),
  check (status not in ('publishing','published') or
    (approved_revision is not null and approved_by is not null and approved_revision = revision and approved_by = user_id and approved_at is not null))
);
alter table public.article_requests enable row level security;
revoke all on public.article_requests from anon, authenticated;
grant select on public.article_requests to authenticated;
grant all on public.article_requests to service_role;
create policy article_requests_read_own on public.article_requests for select to authenticated
  using (user_id = (select auth.uid()));
create index article_requests_brand_idx on public.article_requests(brand_id);
create index article_requests_idea_idx on public.article_requests(idea_id);
create index article_requests_queue_idx on public.article_requests(status,created_at);
create index article_requests_approver_idx on public.article_requests(approved_by);

-- Invoker trigger: never grants a caller additional privileges.
create function public.guard_article_revision() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.content_ideas i join public.article_sites s
      on s.brand_id = i.brand_id where i.id = new.idea_id and i.brand_id = new.brand_id
      and i.user_id = new.user_id and s.user_id = new.user_id) then
      raise exception 'Article idea and site must belong to the same owner and brand';
    end if;
  else
    if (new.user_id,new.brand_id,new.idea_id) is distinct from (old.user_id,old.brand_id,old.idea_id) then
      raise exception 'Article ownership cannot change';
    end if;
    if (new.title,new.body_markdown,new.excerpt,new.slug,new.image_url,new.image_alt,new.category_ids,new.sources)
      is distinct from (old.title,old.body_markdown,old.excerpt,old.slug,old.image_url,old.image_alt,old.category_ids,old.sources) then
      if old.status in ('publishing','published','needs_review') or old.wp_post_id is not null then
        raise exception 'Resolve WordPress publication before editing';
      end if;
      new.revision := old.revision + 1;
      new.approved_revision := null;
      new.approved_by := null;
      new.approved_at := null;
    else
      new.revision := old.revision;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_article_revision() from public,anon,authenticated;
create trigger article_revision_guard before insert or update on public.article_requests
  for each row execute function public.guard_article_revision();

comment on table public.article_requests is
  'AI drafts only until the owner approves a specific revision through article-publisher. Never publish from an idea label.';
