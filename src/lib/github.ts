import { PR, Issue } from "./types";

const REPO_BASE = "https://api.github.com/repos/openclaw/openclaw";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function parsePR(pr: any): PR {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    url: pr.html_url,
    created_at: pr.created_at,
    user: pr.user?.login ?? "unknown",
    comments: (pr.comments ?? 0) + (pr.review_comments ?? 0),
  };
}

function parseIssue(issue: any): Issue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    created_at: issue.created_at,
    user: issue.user?.login ?? "unknown",
    comments: issue.comments ?? 0,
  };
}

/**
 * Fetch open PRs, stopping early once we hit PRs already in the DB.
 */
export async function fetchNewPRs(existingNumbers: Set<number>): Promise<PR[]> {
  const newPRs: PR[] = [];
  const headers = getHeaders();

  let url: string | null =
    `${REPO_BASE}/pulls?state=open&sort=created&direction=desc&per_page=100`;

  while (url) {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    let hitExisting = false;

    for (const pr of data) {
      if (existingNumbers.has(pr.number)) {
        hitExisting = true;
        break;
      }
      newPRs.push(parsePR(pr));
    }

    if (hitExisting) break;

    const linkHeader = res.headers.get("link");
    url = parseLinkNext(linkHeader);
  }

  return newPRs;
}

/**
 * Fetch open issues (excluding pull requests), stopping early once we hit known issues.
 */
export async function fetchNewIssues(existingNumbers: Set<number>): Promise<Issue[]> {
  const newIssues: Issue[] = [];
  const headers = getHeaders();

  let url: string | null =
    `${REPO_BASE}/issues?state=open&sort=created&direction=desc&per_page=100`;

  while (url) {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    let hitExisting = false;

    for (const item of data) {
      // GitHub's /issues endpoint includes PRs — skip them
      if (item.pull_request) continue;

      if (existingNumbers.has(item.number)) {
        hitExisting = true;
        break;
      }
      newIssues.push(parseIssue(item));
    }

    if (hitExisting) break;

    const linkHeader = res.headers.get("link");
    url = parseLinkNext(linkHeader);
  }

  return newIssues;
}

/**
 * Fetch the most recent `count` open items of a given type for quick closure detection.
 * Returns the open item numbers found (up to `count`).
 */
export async function fetchRecentClosedCheck(
  type: "pr" | "issue",
  count = 200
): Promise<number[]> {
  const numbers: number[] = [];
  const headers = getHeaders();
  const endpoint = type === "pr" ? "pulls" : "issues";

  let url: string | null =
    `${REPO_BASE}/${endpoint}?state=open&per_page=100`;

  while (url && numbers.length < count) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json();
    for (const item of data) {
      if (type === "issue" && item.pull_request) continue;
      numbers.push(item.number);
      if (numbers.length >= count) break;
    }

    const linkHeader = res.headers.get("link");
    url = parseLinkNext(linkHeader);
  }

  return numbers;
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
