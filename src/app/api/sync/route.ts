import { NextRequest, NextResponse } from "next/server";
import { fetchOpenPRs } from "@/lib/github";
import { embed } from "@/lib/voyage";
import { upsertPR, querySimilar, getIndex } from "@/lib/pinecone";
import { assignCluster } from "@/lib/cluster";
import { PRMetadata } from "@/lib/types";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prs = await fetchOpenPRs();

    // Get existing PR IDs from Pinecone
    const existingIds = new Set<string>();
    const index = getIndex();
    let paginationToken: string | undefined;

    do {
      const listResult = await index.listPaginated({ paginationToken });
      for (const v of listResult.vectors || []) {
        if (v.id) existingIds.add(v.id);
      }
      paginationToken = listResult.pagination?.next;
    } while (paginationToken);

    let processed = 0;

    for (const pr of prs) {
      const prId = `pr-${pr.number}`;

      if (existingIds.has(prId)) {
        continue;
      }

      try {
        const text = `${pr.title}\n${pr.body}`;
        const [vector] = await embed([text]);

        const similar = await querySimilar(vector, 1);
        const clusterId = assignCluster(similar);

        const metadata: PRMetadata = {
          pr_number: pr.number,
          title: pr.title,
          url: pr.url,
          cluster_id: clusterId,
          created_at: pr.created_at,
        };

        await upsertPR(prId, vector, metadata);
        processed++;
      } catch (err) {
        console.error(`Failed to process PR #${pr.number}:`, err);
      }
    }

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
