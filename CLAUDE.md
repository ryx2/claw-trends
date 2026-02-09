# Claw Trends

PR and issue pattern tracker for the OpenClaw repo. Clusters items by semantic similarity using Voyage AI embeddings + Pinecone.

## Package manager

Use **bun**, not npm.

```bash
bun install        # install deps
bun run dev        # dev server
bun run build      # production build
bun run lint       # eslint
```

## Backfill scripts

```bash
bun run scripts/backfill.ts         # backfill PRs
bun run scripts/backfill-issues.ts  # backfill issues
```

## Stack

- Next.js 16 (App Router, Turbopack)
- Vercel Postgres (`@vercel/postgres`)
- Pinecone (vector DB)
- Voyage AI (embeddings, model: voyage-4)
- PostHog + Vercel Analytics

## Key env vars (`.env.local`)

- `PAT_TOKEN` / `GITHUB_TOKEN` — GitHub API
- `VOYAGE_API_KEY` — Voyage AI embeddings
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` — Pinecone
- `POSTGRES_URL` — Vercel Postgres connection string
- `CRON_SECRET` — auth token for `/api/sync`
