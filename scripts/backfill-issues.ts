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
interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  created_at: string;
  comments: number;
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

// ── GitHub: fetch all open issues (excluding PRs) ────────────────
async function fetchAllOpenIssues(): Promise<Issue[]> {
  const allIssues: Issue[] = [];
  let url: string | null =
    "https://api.github.com/repos/openclaw/openclaw/issues?state=open&per_page=100";

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
    for (const item of data) {
      // GitHub /issues endpoint includes PRs — skip them
      if (item.pull_request) continue;

      allIssues.push({
        number: item.number,
        title: item.title,
        body: item.body ?? "",
        url: item.html_url,
        created_at: item.created_at,
        comments: item.comments ?? 0,
      });
    }

    // Parse Link header for next page
    const linkHeader: string | null = res.headers.get("link");
    const nextMatch: RegExpMatchArray | null | undefined = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
    page++;
  }

  return allIssues;
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
  console.log("\n🦞 Claw Trends — Issues Backfill\n");

  // 1. Fetch all open issues
  console.log("1/6 Fetching open issues from GitHub...");
  const issues = await fetchAllOpenIssues();
  console.log(`     Found ${issues.length} open issues\n`);

  if (issues.length === 0) {
    console.log("No issues to backfill. Done!");
    return;
  }

  // 2. Embed all issues in parallel batches
  console.log("2/6 Embedding issues with Voyage AI...");
  const texts = issues.map((issue) => `${issue.title}\n${issue.body}`);
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
    console.log(`     Embedded ${embeddedCount}/${issues.length}`);
  }
  console.log();

  // 3. Batch upsert to Pinecone
  console.log("3/6 Upserting vectors to Pinecone...");
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index(process.env.PINECONE_INDEX_NAME!);

  const vectors = issues.map((issue, i) => ({
    id: `issue-${issue.number}`,
    values: allEmbeddings[i],
    metadata: {
      issue_number: issue.number,
      title: issue.title,
      url: issue.url,
      created_at: issue.created_at,
      cluster_id: "", // will be set after clustering
    },
  }));

  const upsertBatches = chunk(vectors, PINECONE_UPSERT_BATCH);
  for (let i = 0; i < upsertBatches.length; i++) {
    await index.upsert({ records: upsertBatches[i] });
    console.log(
      `     Upserted batch ${i + 1}/${upsertBatches.length} (${Math.min((i + 1) * PINECONE_UPSERT_BATCH, issues.length)}/${issues.length})`
    );
  }
  console.log();

  // 4. Query each vector for top-K neighbors
  console.log("4/6 Querying for similar issues (building similarity graph)...");
  const issueIds = issues.map((issue) => `issue-${issue.number}`);
  const uf = new UnionFind();

  // Initialize all nodes
  for (const id of issueIds) uf.find(id);

  let queriedCount = 0;
  await runWithConcurrency(
    issues.map((issue, i) => ({ issue, embedding: allEmbeddings[i] })),
    QUERY_CONCURRENCY,
    async ({ issue, embedding }) => {
      const result = await index.query({
        vector: embedding,
        topK: 10,
        includeMetadata: true,
      });

      for (const match of result.matches || []) {
        if (match.id === `issue-${issue.number}`) continue; // skip self
        if (!match.id.startsWith("issue-")) continue; // only cluster with other issues
        if ((match.score ?? 0) >= SIMILARITY_THRESHOLD) {
          uf.union(`issue-${issue.number}`, match.id);
        }
      }

      queriedCount++;
      if (queriedCount % 100 === 0 || queriedCount === issues.length) {
        console.log(`     Queried ${queriedCount}/${issues.length}`);
      }
    }
  );
  console.log();

  // 5. Assign cluster IDs and update Pinecone metadata
  console.log("5/6 Assigning clusters via Union-Find...");
  const groups = uf.getGroups();
  console.log(`     Found ${groups.size} clusters from ${issues.length} issues`);

  // Map each issue to its cluster ID (use the root issue ID as cluster name)
  const issueClusterMap = new Map<string, string>();
  for (const [root, members] of groups) {
    for (const member of members) {
      issueClusterMap.set(member, root);
    }
  }

  // Update Pinecone with cluster_id in metadata
  const updateVectors = issues.map((issue, i) => ({
    id: `issue-${issue.number}`,
    values: allEmbeddings[i],
    metadata: {
      issue_number: issue.number,
      title: issue.title,
      url: issue.url,
      created_at: issue.created_at,
      cluster_id: issueClusterMap.get(`issue-${issue.number}`) || `issue-${issue.number}`,
    },
  }));

  const updateBatches = chunk(updateVectors, PINECONE_UPSERT_BATCH);
  for (let i = 0; i < updateBatches.length; i++) {
    await index.upsert({ records: updateBatches[i] });
  }
  console.log(`     Updated Pinecone metadata with cluster IDs\n`);

  // 6. Insert into Postgres
  console.log("6/6 Inserting into Postgres...");

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      pinecone_id VARCHAR(255) PRIMARY KEY,
      issue_number INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      cluster_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      comments INTEGER NOT NULL DEFAULT 0
    )
  `);

  let insertedCount = 0;
  for (const issueBatch of chunk(issues, 50)) {
    const values: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    for (const issue of issueBatch) {
      const issueId = `issue-${issue.number}`;
      const clusterId = issueClusterMap.get(issueId) || issueId;
      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, 'open', $${paramIdx + 6})`
      );
      params.push(issueId, issue.number, issue.title, issue.url, clusterId, issue.created_at, issue.comments);
      paramIdx += 7;
    }

    await pool.query(
      `INSERT INTO issues (pinecone_id, issue_number, title, url, cluster_id, created_at, status, comments)
       VALUES ${values.join(", ")}
       ON CONFLICT (pinecone_id) DO NOTHING`,
      params
    );
    insertedCount += issueBatch.length;
    console.log(`     Inserted ${insertedCount}/${issues.length}`);
  }

  await pool.end();

  // Print summary
  console.log("\n✅ Issues backfill complete!\n");

  const clusterSizes = Array.from(groups.values())
    .map((g) => g.length)
    .sort((a, b) => b - a);

  console.log(`   Total issues:  ${issues.length}`);
  console.log(`   Clusters:      ${groups.size}`);
  console.log(`   Largest:       ${clusterSizes[0]} issues`);
  console.log(`   Top 10:`);

  const issueMap = new Map(issues.map((issue) => [`issue-${issue.number}`, issue]));
  const sortedGroups = Array.from(groups.entries())
    .map(([root, members]) => ({
      root,
      members,
      label: issueMap.get(members[0])?.title || root,
    }))
    .sort((a, b) => b.members.length - a.members.length);

  for (const group of sortedGroups.slice(0, 10)) {
    console.log(`     ${group.members.length.toString().padStart(4)} │ ${group.label.slice(0, 80)}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Issues backfill failed:", err);
  process.exit(1);
});
