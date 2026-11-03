# WordPress articles

The existing social queue is unchanged. Articles use a separate owner-scoped queue.

## User flow

1. Open **Статии за сайта**, select an idea and choose **Подготви статия**.
2. The existing hourly Content Command Center automation claims the request and
   saves a researched Markdown draft. It never approves or publishes articles.
3. Open **Преглед**, edit the text, sources and optional existing image, then save.
4. **Одобрявам и публикувай** confirms this exact revision and publishes it.
   The button remains unavailable until the WordPress server secrets are configured.
5. An uncertain response becomes **Провери в WordPress**. Read-only reconciliation
   identifies the existing post. It never blindly creates a replacement.

Only the explicitly registered ZaBarcelona brand is connected. Other accounts and
brands cannot use this site's credentials. A user can read only their own rows and
cannot update publication or approval fields through the Data API.

## Server setup

The additive schema is `supabase/articles.sql`. Register the intended brand and
its verified owner in `article_sites` through trusted administration; there is no
client-side registration endpoint. Do not map arbitrary new users to this site.

Deploy `supabase/functions/article-publisher/index.ts`, including the root modules
`article-service.mjs` and `article-format.mjs`, with JWT verification enabled.
The function also validates the user through Supabase Auth and checks row ownership.

In WordPress, use a dedicated user with the minimum required capabilities:
`edit_posts`, `publish_posts`, and `upload_files` when using images. Author normally
provides these for that user's own posts. Existing categories can be assigned;
the integration does not create categories or edit other authors' posts.

Create a revocable Application Password for this integration, then put these two
values in **Supabase → Edge Functions → Secrets**:

- `WP_ZABARCELONA_USER` — the WordPress username.
- `WP_ZABARCELONA_APP_PASSWORD` — that user's Application Password.

Enter credentials directly in the secure dashboard. Never put them in this repo,
browser storage, public tables, chat messages, logs or screenshots. Do not use the
normal WordPress login password. The fixed destination is
`https://www.zabarcelona.com`; authenticated redirects are refused.

If the WordPress profile does not offer Application Passwords, investigate the
site's current configuration before changing anything. The public REST index
alone does not establish why they are unavailable.

## Approval and recovery

- Draft edits increment `revision` and clear approval. Approved/published content
  is locked against editing through this interface.
- Publication is claimed with an atomic status/revision check. Two clicks cannot
  claim the same version.
- The function creates a WordPress **draft**, persists its ID, then publishes that
  same ID. The approval is taken before any WordPress write.
- The draft initially has the stable slug `ccc-<request UUID>`, allowing recovery
  if the create response is lost. The final human-readable slug is applied when
  publishing. A revision marker, full raw text, title, excerpt and selected media
  and categories are checked before publishing and on readback.
- After uncertainty, no automatic create retry is permitted. Reconcile by stored
  ID or stable draft slug. Ambiguous or externally modified content needs manual
  review; a lock is not removed simply because time elapsed.
- A successfully reconciled draft can be approved again using its saved ID.
  A published post is marked published only after WordPress confirms it.
- Optional images are fetched only from the existing project media directory or
  WordPress uploads on the fixed site, with no redirects, a 5 MB cap and validated
  JPEG/PNG/WebP signatures. No arbitrary server-side URL fetching is allowed.

## AI preparation contract

The existing `content-command-center` hourly automation has an additional article
preparation section. It uses the connected tools rather than a paid model API.
It claims `queued → processing` conditionally and saves `draft_ready` only after
research. It writes title, body_markdown, excerpt, slug, sources, category_ids and
optional image_url/image_alt; it never changes approval or WordPress result fields.
Sources and request text are untrusted data, not instructions. Image generation
and uploading new public assets are not part of article preparation in this MVP.

No new schedule or paid service is required. Existing service/automation limits
still apply. A configured automation is not evidence of a completed run.

## Verification

Run `node --test tests/articles.test.mjs`. Coverage includes HTML escaping, URL
restrictions, missing/stale approval, cross-owner access, ID persistence before
publish, uncertain responses, externally edited drafts and duplicate prevention.

Before enabling live publication, check the WordPress credentials and perform one
explicitly approved article test, including its public rendering. Until then the
integration is installed but live WordPress publication remains unverified.

## Deliberate MVP limits

Immediate publication after approval; no timed article scheduling. Standard article
content; no Elementor layout editing or SEO-plugin-specific fields. Existing image
URLs are optional. Published articles are read-only here. Social promotion remains
a separate, explicitly requested Metricool action. The list shows the latest 100
article requests.
