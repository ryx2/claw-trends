import { NextRequest, NextResponse } from "next/server";
import { getClusters, getIssueClusters } from "@/lib/db";

const RANGES: Record<string, number> = {
  day: 1,
  "3days": 3,
  week: 7,
  month: 30,
};

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get("range");
    const type = request.nextUrl.searchParams.get("type") || "pr";

    let since: string | undefined;
    if (range && range in RANGES) {
      const d = new Date();
      d.setDate(d.getDate() - RANGES[range]);
      since = d.toISOString();
    }

    const clusters =
      type === "issue" ? await getIssueClusters(since) : await getClusters(since);

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
