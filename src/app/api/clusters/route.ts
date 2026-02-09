import { NextResponse } from "next/server";
import { getClusters } from "@/lib/db";

export async function GET() {
  try {
    const clusters = await getClusters();

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
