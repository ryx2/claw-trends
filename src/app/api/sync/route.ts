import { NextRequest, NextResponse } from "next/server";
import { fetchNewPRs, fetchNewIssues, fetchRecentClosedCheck } from "@/lib/github";
import { embed } from "@/lib/voyage";
import { upsertPR, upsertIssue, querySimilar } from "@/lib/pinecone";
import { assignCluster } from "@/lib/cluster";
import {
  ensureTable,
  ensureIssuesTable,
  ensureSyncMetaTable,
  insertPR,
  insertIssue,
  getExistingPRNumbers,
  getExistingIssueNumbers,
  markClosedPRs,
  markClosedIssues,
  getSyncMeta,
  setSyncMeta,
} from "@/lib/db";
import { PRMetadata, IssueMetadata } from "@/lib/types";

const FULL_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureTable();
    await ensureIssuesTable();
    await ensureSyncMetaTable();

    // --- Sync PRs ---
    const existingPRNumbers = await getExistingPRNumbers();
    const prs = await fetchNewPRs(existingPRNumbers);

    let processedPRs = 0;
    for (const pr of prs) {
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
        await insertPR(prId, pr.number, pr.title, pr.url, clusterId, pr.created_at, pr.comments);
        processedPRs++;
      } catch (err) {
        console.error(`Failed to process PR #${pr.number}:`, err);
      }
    }

    // --- Sync Issues ---
    const existingIssueNumbers = await getExistingIssueNumbers();
    const issues = await fetchNewIssues(existingIssueNumbers);

    let processedIssues = 0;
    for (const issue of issues) {
      try {
        const text = `${issue.title}\n${issue.body}`;
        const [vector] = await embed([text]);

        const similar = await querySimilar(vector, 1);
        const clusterId = assignCluster(similar);

        const issueId = `issue-${issue.number}`;
        const metadata: IssueMetadata = {
          issue_number: issue.number,
          title: issue.title,
          url: issue.url,
          cluster_id: clusterId,
          created_at: issue.created_at,
        };

        await upsertIssue(issueId, vector, metadata);
        await insertIssue(issueId, issue.number, issue.title, issue.url, clusterId, issue.created_at, issue.comments);
        processedIssues++;
      } catch (err) {
        console.error(`Failed to process Issue #${issue.number}:`, err);
      }
    }

    // --- Closure detection (only on full hourly check) ---
    // Quick checks with partial data (e.g. 200 items) would incorrectly
    // mark everything else as closed, so we only run closure detection
    // during the full check.
    const lastFullCheck = await getSyncMeta("last_full_closure_check");
    const now = Date.now();
    const needsFullCheck =
      !lastFullCheck || now - new Date(lastFullCheck).getTime() > FULL_CHECK_INTERVAL_MS;

    if (needsFullCheck) {
      const openPRs = await fetchRecentClosedCheck("pr", Infinity);
      await markClosedPRs(openPRs);

      const openIssues = await fetchRecentClosedCheck("issue", Infinity);
      await markClosedIssues(openIssues);

      await setSyncMeta("last_full_closure_check", new Date(now).toISOString());
    }

    return NextResponse.json({
      processedPRs,
      processedIssues,
      totalNewPRs: prs.length,
      totalNewIssues: issues.length,
      fullClosureCheck: needsFullCheck,
    });
  } catch (err) {
    console.error("Sync failed:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
