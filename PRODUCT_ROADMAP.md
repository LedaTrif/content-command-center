# Product roadmap

## Free MVP

- Personal account and secure sign-in
- Business profile: name, logo, description, language, audience and tone
- Up to 3 brands per account
- Brand-specific topics, sources, prompts and social channels
- Multi-select editorial workflow
- Daily news collection and duplicate prevention
- Metricool handoff and Canva design handoff

## Data model

- `profiles`: user identity and preferences
- `workspaces`: owner and subscription tier
- `brands`: maximum 3 on free tier
- `brand_guidelines`: voice, audience, languages, CTA and forbidden claims
- `sources`: RSS feeds, domains, keywords and trust level
- `ideas`: source facts, relevance, urgency and lifecycle
- `idea_labels`: many-to-many statuses such as approved + newsletter
- `content_assets`: channel copy, image brief and Canva URL
- `integrations`: encrypted provider tokens and connection state
- `publications`: Metricool draft/schedule identifiers and results

## Safe AI personalization

Users never provide their ChatGPT password. The app stores a structured brand
profile and sends only the relevant brand instructions to an AI service through
a protected server. User-provided API keys, if offered later, must be encrypted
and never exposed in browser code or GitHub.

## Build sequence

1. Supabase Auth, database and Row Level Security
2. Onboarding and editable business profile
3. Brand switcher and 3-brand free limit
4. AI brand interview and prompt-profile generator
5. Metricool draft creation through a secure server function
6. Canva template/design handoff per brand
7. Paid plans, teams, approval roles and analytics
