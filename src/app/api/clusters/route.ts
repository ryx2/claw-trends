import { NextResponse } from "next/server";
import { fetchAllPRs } from "@/lib/pinecone";
import { Cluster } from "@/lib/types";

export async function GET() {
  try {
    const allPRs = await fetchAllPRs();

    // Group by cluster_id
    const groups = new Map<
      string,
      { pr_number: number; title: string; url: string; created_at: string }[]
    >();

    for (const pr of allPRs) {
      const key = pr.cluster_id;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push({
        pr_number: pr.pr_number,
        title: pr.title,
        url: pr.url,
        created_at: pr.created_at,
      });
    }

    const clusters: Cluster[] = [];

    for (const [id, prs] of groups) {
      // Sort by created_at ascending to find earliest PR for label
      prs.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      clusters.push({
        id,
        label: prs[0].title,
        count: prs.length,
        prs: prs.map((p) => ({
          number: p.pr_number,
          title: p.title,
          url: p.url,
        })),
      });
    }

    // Sort by count descending
    clusters.sort((a, b) => b.count - a.count);

    return NextResponse.json(
      { clusters },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch clusters:", err);
    return NextResponse.json(
      { error: "Failed to fetch clusters" },
      { status: 500 }
    );
  }
}
