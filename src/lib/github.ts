import { PR } from "./types";

const BASE_URL = "https://api.github.com/repos/openclaw/openclaw/pulls";

export async function fetchOpenPRs(since?: string): Promise<PR[]> {
  const allPRs: PR[] = [];
  const sinceDate = since ? new Date(since) : null;

  let url: string | null =
    `${BASE_URL}?state=open&sort=created&direction=desc&per_page=100`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  while (url) {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(
        `GitHub API error: ${res.status} ${res.statusText}`
      );
    }

    const data = await res.json();
    let hitOldPR = false;

    for (const pr of data) {
      // Stop if this PR is older than our latest
      if (sinceDate && new Date(pr.created_at) <= sinceDate) {
        hitOldPR = true;
        break;
      }

      allPRs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        url: pr.html_url,
        created_at: pr.created_at,
        user: pr.user?.login ?? "unknown",
        comments: (pr.comments ?? 0) + (pr.review_comments ?? 0),
      });
    }

    if (hitOldPR) break;

    // Handle pagination via Link header
    const linkHeader = res.headers.get("link");
    url = parseLinkNext(linkHeader);
  }

  return allPRs;
}

export async function fetchOpenPRNumbers(): Promise<number[]> {
  const numbers: number[] = [];
  let url: string | null =
    `${BASE_URL}?state=open&per_page=100`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json();
    for (const pr of data) {
      numbers.push(pr.number);
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
