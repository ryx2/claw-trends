# Claw Trends

Track the most common PR patterns in [OpenClaw](https://github.com/openclaw/openclaw).

PRs are embedded with [Voyage AI](https://voyageai.com), stored in [Pinecone](https://pinecone.io), and automatically clustered by similarity.

## Setup

1. Create a Pinecone index named `claw-trends` with **dimension 1024** (voyage-3-lite) and **cosine** metric
2. Get API keys:
   - [Voyage AI](https://dash.voyageai.com/) for embeddings
   - [Pinecone](https://app.pinecone.io/) for vector storage
3. Deploy to [Vercel](https://vercel.com) and set environment variables (see `.env.example`)
4. Set up GitHub Actions secrets:
   - `DEPLOY_URL` - your Vercel deployment URL (e.g., `https://claw-trends.vercel.app`)
   - `CRON_SECRET` - a random secret string matching your Vercel env var

## How It Works

1. **GitHub Actions** cron hits `/api/sync` every minute
2. New PRs are fetched from the OpenClaw repo
3. Each PR's title + description is embedded with Voyage AI
4. Embeddings are stored in Pinecone with cluster assignments
5. Similar PRs (cosine similarity > 0.82) are grouped into clusters
6. The frontend displays clusters sorted by frequency, refreshing every 30s

## Local Development

```bash
cp .env.example .env.local
# Fill in your API keys
npm run dev
```

## Tech Stack

- **Next.js** - React framework
- **Voyage AI** - Text embeddings (voyage-3-lite)
- **Pinecone** - Vector database for similarity search
- **Vercel** - Hosting
- **GitHub Actions** - Cron job for syncing
