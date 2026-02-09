import { sql } from "@vercel/postgres";

export async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS prs (
      pinecone_id VARCHAR(255) PRIMARY KEY,
      pr_number INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      cluster_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open'
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prs_cluster_id ON prs (cluster_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prs_status ON prs (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prs_created_at ON prs (created_at)`;
}

export async function insertPR(
  pineconeId: string,
  prNumber: number,
  title: string,
  url: string,
  clusterId: string,
  createdAt: string
) {
  await sql`
    INSERT INTO prs (pinecone_id, pr_number, title, url, cluster_id, created_at, status)
    VALUES (${pineconeId}, ${prNumber}, ${title}, ${url}, ${clusterId}, ${createdAt}, 'open')
    ON CONFLICT (pinecone_id) DO NOTHING
  `;
}

export async function getExistingPRNumbers(): Promise<Set<number>> {
  const result = await sql`SELECT pr_number FROM prs`;
  return new Set(result.rows.map((r) => r.pr_number));
}

export async function getLatestPRTimestamp(): Promise<string | null> {
  const result = await sql`SELECT MAX(created_at) AS latest FROM prs`;
  const latest = result.rows[0]?.latest;
  return latest ? new Date(latest).toISOString() : null;
}

export async function markClosedPRs(openPRNumbers: number[]) {
  if (openPRNumbers.length === 0) {
    await sql`UPDATE prs SET status = 'closed' WHERE status = 'open'`;
    return;
  }

  const openSet = openPRNumbers.join(",");
  await sql.query(
    `UPDATE prs SET status = 'closed' WHERE status = 'open' AND pr_number != ALL($1::int[])`,
    [openPRNumbers]
  );
}

export async function getClusters() {
  const result = await sql`
    SELECT
      cluster_id,
      COUNT(*)::int AS count,
      json_agg(
        json_build_object(
          'number', pr_number,
          'title', title,
          'url', url,
          'status', status,
          'created_at', created_at
        )
        ORDER BY created_at DESC
      ) AS prs,
      MAX(created_at) AS latest_pr
    FROM prs
    GROUP BY cluster_id
    ORDER BY latest_pr DESC
  `;

  return result.rows.map((row) => ({
    id: row.cluster_id,
    label: row.prs[0].title,
    count: row.count,
    prs: row.prs,
  }));
}
