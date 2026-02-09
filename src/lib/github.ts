import { PR } from "./types";

const GITHUB_API =
  "https://api.github.com/repos/openclaw/openclaw/pulls?state=open&per_page=100";

export async function fetchOpenPRs(): Promise<PR[]> {
  const allPRs: PR[] = [];
  let url: string | null = GITHUB_API;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  while (url) {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(
        `GitHub API error: ${res.status} ${res.statusText}`
      );
    }

    const data = await res.json();

    for (const pr of data) {
      allPRs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        url: pr.html_url,
        created_at: pr.created_at,
        user: pr.user?.login ?? "unknown",
      });
    }

    // Handle pagination via Link header
    const linkHeader = res.headers.get("link");
    url = parseLinkNext(linkHeader);
  }

  return allPRs;
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
