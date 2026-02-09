import { Pinecone } from "@pinecone-database/pinecone";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  process.env[key] = val;
}

// ── Config ───────────────────────────────────────────────────────
const SIMILARITY_THRESHOLD = 0.82;
const VOYAGE_BATCH_SIZE = 50;
const PINECONE_UPSERT_BATCH = 100;
const QUERY_CONCURRENCY = 20;
const VOYAGE_CONCURRENCY = 3;

// ── Types ────────────────────────────────────────────────────────
interface PR {
  number: number;
  title: string;
  body: string;
  url: string;
  created_at: string;
}

// ── Union-Find ───────────────────────────────────────────────────
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: string, y: string) {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    const rx = this.rank.get(px) || 0;
    const ry = this.rank.get(py) || 0;
    if (rx < ry) {
      this.parent.set(px, py);
    } else if (rx > ry) {
      this.parent.set(py, px);
    } else {
      this.parent.set(py, px);
      this.rank.set(px, rx + 1);
    }
  }

  getGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(key);
    }
    return groups;
  }
}

// ── GitHub: fetch all open PRs ───────────────────────────────────
async function fetchAllOpenPRs(): Promise<PR[]> {
  const allPRs: PR[] = [];
  let url: string | null =
    "https://api.github.com/repos/openclaw/openclaw/pulls?state=open&per_page=100";

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let page = 1;
  while (url) {
    console.log(`  Fetching page ${page}...`);
    const res: Response = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json();
    for (const pr of data) {
      allPRs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        url: pr.html_url,
        created_at: pr.created_at,
      });
    }

    // Parse Link header for next page
    const linkHeader: string | null = res.headers.get("link");
    const nextMatch: RegExpMatchArray | null | undefined = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
    page++;
  }

  return allPRs;
}

// ── Voyage: batch embed ──────────────────────────────────────────
async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: "voyage-4" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

// ── Helpers ──────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (const batch of chunk(items, concurrency)) {
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("\n🦞 Claw Trends Backfill\n");

  // 1. Fetch all open PRs
  console.log("1/6 Fetching open PRs from GitHub...");
  const prs = await fetchAllOpenPRs();
  console.log(`     Found ${prs.length} open PRs\n`);

  // 2. Embed all PRs in parallel batches
  console.log("2/6 Embedding PRs with Voyage AI...");
  const texts = prs.map((pr) => `${pr.title}\n${pr.body}`);
  const textBatches = chunk(texts, VOYAGE_BATCH_SIZE);

  const allEmbeddings: number[][] = [];
  let embeddedCount = 0;

  for (const batchGroup of chunk(textBatches, VOYAGE_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batchGroup.map((batch) => embedBatch(batch))
    );
    for (const embeddings of batchResults) {
      allEmbeddings.push(...embeddings);
      embeddedCount += embeddings.length;
    }
    console.log(`     Embedded ${embeddedCount}/${prs.length}`);
  }
  console.log();

  // 3. Batch upsert to Pinecone
  console.log("3/6 Upserting vectors to Pinecone...");
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index(process.env.PINECONE_INDEX_NAME!);

  const vectors = prs.map((pr, i) => ({
    id: `pr-${pr.number}`,
    values: allEmbeddings[i],
    metadata: {
      pr_number: pr.number,
      title: pr.title,
      url: pr.url,
      created_at: pr.created_at,
      cluster_id: "", // will be set after clustering
    },
  }));

  const upsertBatches = chunk(vectors, PINECONE_UPSERT_BATCH);
  for (let i = 0; i < upsertBatches.length; i++) {
    await index.upsert({ records: upsertBatches[i] });
    console.log(
      `     Upserted batch ${i + 1}/${upsertBatches.length} (${Math.min((i + 1) * PINECONE_UPSERT_BATCH, prs.length)}/${prs.length})`
    );
  }
  console.log();

  // 4. Query each vector for top-K neighbors
  console.log("4/6 Querying for similar PRs (building similarity graph)...");
  const prIds = prs.map((pr) => `pr-${pr.number}`);
  const uf = new UnionFind();

  // Initialize all nodes
  for (const id of prIds) uf.find(id);

  let queriedCount = 0;
  await runWithConcurrency(
    prs.map((pr, i) => ({ pr, embedding: allEmbeddings[i] })),
    QUERY_CONCURRENCY,
    async ({ pr, embedding }) => {
      const result = await index.query({
        vector: embedding,
        topK: 10,
        includeMetadata: true,
      });

      for (const match of result.matches || []) {
        if (match.id === `pr-${pr.number}`) continue; // skip self
        if ((match.score ?? 0) >= SIMILARITY_THRESHOLD) {
          uf.union(`pr-${pr.number}`, match.id);
        }
      }

      queriedCount++;
      if (queriedCount % 100 === 0 || queriedCount === prs.length) {
        console.log(`     Queried ${queriedCount}/${prs.length}`);
      }
    }
  );
  console.log();

  // 5. Assign cluster IDs and update Pinecone metadata
  console.log("5/6 Assigning clusters via Union-Find...");
  const groups = uf.getGroups();
  console.log(`     Found ${groups.size} clusters from ${prs.length} PRs`);

  // Map each PR to its cluster ID (use the root PR ID as cluster name)
  const prClusterMap = new Map<string, string>();
  for (const [root, members] of groups) {
    for (const member of members) {
      prClusterMap.set(member, root);
    }
  }

  // Update Pinecone with cluster_id in metadata
  const updateVectors = prs.map((pr, i) => ({
    id: `pr-${pr.number}`,
    values: allEmbeddings[i],
    metadata: {
      pr_number: pr.number,
      title: pr.title,
      url: pr.url,
      created_at: pr.created_at,
      cluster_id: prClusterMap.get(`pr-${pr.number}`) || `pr-${pr.number}`,
    },
  }));

  const updateBatches = chunk(updateVectors, PINECONE_UPSERT_BATCH);
  for (let i = 0; i < updateBatches.length; i++) {
    await index.upsert({ records: updateBatches[i] });
  }
  console.log(`     Updated Pinecone metadata with cluster IDs\n`);

  // 6. Insert into Postgres
  console.log("6/6 Inserting into Postgres...");

  // Use pg directly since @vercel/postgres needs Vercel runtime
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prs (
      pinecone_id VARCHAR(255) PRIMARY KEY,
      pr_number INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      cluster_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open'
    )
  `);

  let insertedCount = 0;
  for (const prBatch of chunk(prs, 50)) {
    const values: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    for (const pr of prBatch) {
      const prId = `pr-${pr.number}`;
      const clusterId = prClusterMap.get(prId) || prId;
      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, 'open')`
      );
      params.push(prId, pr.number, pr.title, pr.url, clusterId, pr.created_at);
      paramIdx += 6;
    }

    await pool.query(
      `INSERT INTO prs (pinecone_id, pr_number, title, url, cluster_id, created_at, status)
       VALUES ${values.join(", ")}
       ON CONFLICT (pinecone_id) DO NOTHING`,
      params
    );
    insertedCount += prBatch.length;
    console.log(`     Inserted ${insertedCount}/${prs.length}`);
  }

  await pool.end();

  // Print summary
  console.log("\n✅ Backfill complete!\n");

  const clusterSizes = Array.from(groups.values())
    .map((g) => g.length)
    .sort((a, b) => b - a);

  console.log(`   Total PRs:     ${prs.length}`);
  console.log(`   Clusters:      ${groups.size}`);
  console.log(`   Largest:       ${clusterSizes[0]} PRs`);
  console.log(`   Top 10:`);

  const prMap = new Map(prs.map((pr) => [`pr-${pr.number}`, pr]));
  const sortedGroups = Array.from(groups.entries())
    .map(([root, members]) => ({
      root,
      members,
      label: prMap.get(members[0])?.title || root,
    }))
    .sort((a, b) => b.members.length - a.members.length);

  for (const group of sortedGroups.slice(0, 10)) {
    console.log(`     ${group.members.length.toString().padStart(4)} │ ${group.label.slice(0, 80)}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
