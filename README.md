# Content Command Center

Content approval dashboard built first for **ZaBarcelona**, with a brand-configurable architecture for future businesses.

## MVP features

- Content Inbox with relevance and urgency scoring
- One-click Approve / Reject / Later / Newsletter workflow
- Tags for Barcelona, properties, tourism, documents, events and community
- Search, filters, sorting and workflow statistics
- Add custom ideas
- Generate, copy and export post drafts for Metricool
- Local persistence in the browser
- Responsive desktop and mobile interface

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
3. Supabase authentication and cloud database
4. Brand profiles, tone, topics, sources and publishing rules
5. Editorial calendar and newsletter builder
6. Metricool direct integration when API access is available
7. Analytics feedback loop: learn which topics are approved and perform best

## Data model for the scalable version

`workspace → brands → sources → ideas → content assets → distribution channels`

The current MVP deliberately keeps data in `localStorage` so the editorial workflow can be validated before adding infrastructure costs.
