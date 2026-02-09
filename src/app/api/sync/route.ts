import { NextRequest, NextResponse } from "next/server";
import { fetchOpenPRs, fetchOpenPRNumbers } from "@/lib/github";
import { embed } from "@/lib/voyage";
import { upsertPR, querySimilar } from "@/lib/pinecone";
import { assignCluster } from "@/lib/cluster";
import { ensureTable, insertPR, getExistingPRNumbers, getLatestPRTimestamp, markClosedPRs } from "@/lib/db";
import { PRMetadata } from "@/lib/types";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureTable();

    const latestTimestamp = await getLatestPRTimestamp();
    const prs = await fetchOpenPRs(latestTimestamp ?? undefined);
    const existingNumbers = await getExistingPRNumbers();

    let processed = 0;

    for (const pr of prs) {
      if (existingNumbers.has(pr.number)) {
        continue;
      }

      try {
        const text = `${pr.title}\n${pr.body}`;
        const [vector] = await embed([text]);

        const similar = await querySimilar(vector, 1);
        const clusterId = assignCluster(similar);

        const prId = `pr-${pr.number}`;
        const metadata: PRMetadata = {
          pr_number: pr.number,
          title: pr.title,
          url: pr.url,
          cluster_id: clusterId,
          created_at: pr.created_at,
        };

        await upsertPR(prId, vector, metadata);
        await insertPR(prId, pr.number, pr.title, pr.url, clusterId, pr.created_at);
        processed++;
      } catch (err) {
        console.error(`Failed to process PR #${pr.number}:`, err);
      }
    }

    // Fetch full list of currently open PR numbers to detect closures
    const allOpenNumbers = await fetchOpenPRNumbers();
    await markClosedPRs(allOpenNumbers);

    return NextResponse.json({
      processed,
      total: prs.length,
      newPRs: processed,
    });
  } catch (err) {
    console.error("Sync failed:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
