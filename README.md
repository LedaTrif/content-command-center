# Content Command Center

Content approval dashboard built first for **ZaBarcelona**, with a brand-configurable architecture for future businesses.

## MVP features

- Content Inbox with relevance and urgency scoring
- Multi-select workflow: Approved + Newsletter + Later + Ready can be combined
- Tags for Barcelona, properties, tourism, documents, events and community
- Search, filters, sorting and workflow statistics
- Add custom ideas
- Generate, copy and export post drafts for Metricool
- Local persistence in the browser
- Daily Barcelona news collection with GitHub Actions
- Responsive desktop and mobile interface
- Supabase email/password registration and sign-in
- Cloud persistence protected with Row Level Security
- Editable user profile and AI writing preferences
- Up to three separate brand profiles per account
- Brand logo upload, language and tone settings
- Secure brand switching with isolated content libraries

## Run locally

No build step is required. Open `index.html`, or run:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Publish with GitHub Pages

Push this folder to a new GitHub repository. In **Settings → Pages**, select **Deploy from a branch**, `main`, `/ (root)`.

## Product roadmap

1. Automated source collection through RSS/APIs and scheduled GitHub Actions
2. AI fact extraction, duplicate detection and Bulgarian draft generation
3. AI draft and image generation through protected Edge Functions
4. Metricool draft creation and scheduling
5. Canva connection per brand
6. Editorial calendar and newsletter builder
7. Analytics feedback loop: learn which topics are approved and perform best

## Data model for the scalable version

`workspace → brands → sources → ideas → content assets → distribution channels`

Authentication, profiles, brands and content decisions are stored in Supabase. The public client uses only a publishable key; secret service keys must never be committed to this repository.
