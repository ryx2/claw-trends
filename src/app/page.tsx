"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface Item {
  number: number;
  title: string;
  url: string;
  status: string;
  created_at: string;
  comments: number;
}

interface Cluster {
  id: string;
  label: string;
  count: number;
  prs: Item[];
}

const RANGES = [
  { key: "day", label: "Today" },
  { key: "3days", label: "3 Days" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All Time" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];
type TabType = "pr" | "issue";

const VALID_RANGES = new Set<string>(RANGES.map((r) => r.key));

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabType>("pr");
  const [copied, setCopied] = useState<string | null>(null);
  const clusterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasScrolledToHash = useRef(false);
  const [skipAnimation, setSkipAnimation] = useState<Set<string>>(new Set());

  const range = useMemo<RangeKey>(() => {
    const param = searchParams.get("range");
    return param && VALID_RANGES.has(param) ? (param as RangeKey) : "all";
  }, [searchParams]);

  function setRange(r: RangeKey) {
    const params = r === "all" ? "/" : `?range=${r}`;
    router.push(params, { scroll: false });
  }

  const fetchClusters = useCallback(async (r: RangeKey, tab: TabType) => {
    try {
      const params = new URLSearchParams();
      if (r !== "all") params.set("range", r);
      params.set("type", tab);
      const qs = params.toString();
      const res = await fetch(`/api/clusters?${qs}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setClusters(data.clusters);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchClusters(range, activeTab);
    const interval = setInterval(() => fetchClusters(range, activeTab), 30_000);
    return () => clearInterval(interval);
  }, [range, activeTab, fetchClusters]);

  // Auto-expand and scroll to cluster from URL hash
  useEffect(() => {
    if (loading || hasScrolledToHash.current || clusters.length === 0) return;
    const hash = window.location.hash.slice(1); // remove #
    if (!hash) return;
    const decoded = decodeURIComponent(hash);
    const match = clusters.find((c) => c.id === decoded);
    if (match) {
      // Skip animation for hash-linked cluster — open it instantly
      setSkipAnimation(new Set([match.id]));
      setExpanded((prev) => new Set(prev).add(match.id));
      hasScrolledToHash.current = true;
      requestAnimationFrame(() => {
        const el = clusterRefs.current.get(match.id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [loading, clusters]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    setExpanded(new Set());
  }

  function shareCluster(e: React.MouseEvent, clusterId: string) {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${encodeURIComponent(clusterId)}`;
    navigator.clipboard.writeText(url);
    setCopied(clusterId);
    setTimeout(() => setCopied(null), 1500);
  }

  const itemLabel = activeTab === "pr" ? "PRs" : "issues";

  return (
    <div style={{ maxWidth: 768, margin: "0 auto", padding: "48px 16px" }}>
      {/* Header */}
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 4 }}>
            {"\uD83E\uDD9E"} Claw Trends
          </h1>
          <p style={{ color: "var(--text-dim)", marginBottom: 8 }}>
            Most common {activeTab === "pr" ? "PR" : "issue"} patterns in OpenClaw
          </p>
          <a
            href="https://github.com/openclaw/openclaw"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-dim)", fontSize: 13, textDecoration: "underline" }}
          >
            github.com/openclaw/openclaw
          </a>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text-dim)", flexShrink: 0 }}>
          <span>Raymond Xu</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <a href="https://github.com/ryx2" target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-dim)", display: "flex" }} title="GitHub">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          </a>
          <span style={{ opacity: 0.3 }}>|</span>
          <a href="https://twitter.com/needhelptho" target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-dim)", display: "flex" }} title="@needhelptho">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
        </div>
      </header>

      {/* PR / Issues tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
        {(["pr", "issue"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            style={{
              padding: "8px 20px",
              border: "1px solid var(--border)",
              borderBottom: activeTab === tab ? "2px solid var(--claw-red)" : "1px solid var(--border)",
              background: activeTab === tab ? "var(--surface)" : "transparent",
              color: activeTab === tab ? "var(--text)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: activeTab === tab ? 600 : 400,
              borderRadius: tab === "pr" ? "6px 0 0 0" : "0 6px 0 0",
              marginRight: tab === "pr" ? -1 : 0,
            }}
          >
            {tab === "pr" ? "Pull Requests" : "Issues"}
          </button>
        ))}
      </div>

      {/* Range tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: range === r.key ? "var(--claw-red)" : "var(--border)",
              background: range === r.key ? "var(--claw-red-dim)" : "transparent",
              color: range === r.key ? "var(--claw-red)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: range === r.key ? 600 : 400,
              transition: "all 0.15s",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 56,
                borderRadius: 8,
                background: "var(--surface)",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p style={{ color: "var(--text-dim)", textAlign: "center", padding: 40 }}>
          Failed to load data. Retrying...
        </p>
      )}

      {/* Empty */}
      {!loading && !error && clusters.length === 0 && (
        <p style={{ color: "var(--text-dim)", textAlign: "center", padding: 40 }}>
          No {itemLabel} found for this time range.
        </p>
      )}

      {/* Cluster list */}
      {!loading && !error && clusters.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {clusters.map((cluster, idx) => {
            const isOpen = expanded.has(cluster.id);
            const t = clusters.length > 1 ? idx / (clusters.length - 1) : 0;
            const r = Math.round(229 * (1 - t));
            const g = Math.round(77 * (1 - t));
            const b = Math.round(46 * (1 - t));
            const badgeColor = `rgb(${r}, ${g}, ${b})`;
            return (
              <div
                key={cluster.id}
                ref={(el) => { if (el) clusterRefs.current.set(cluster.id, el); }}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  transition: "background 0.15s",
                }}
              >
                <button
                  onClick={() => toggleExpand(cluster.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    background: "none",
                    border: "none",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 15,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--surface-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <span
                    style={{
                      minWidth: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: badgeColor,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {cluster.count}
                  </span>
                  <span style={{ flex: 1 }}>{cluster.label}</span>
                  <span
                    onClick={(e) => shareCluster(e, cluster.id)}
                    title="Copy link to this cluster"
                    style={{
                      color: copied === cluster.id ? "var(--claw-red)" : "var(--text-dim)",
                      fontSize: 12,
                      padding: "4px 6px",
                      borderRadius: 4,
                      transition: "color 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    {copied === cluster.id ? "Copied!" : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", verticalAlign: "-2px", marginRight: 3 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>Link</>}
                  </span>
                  <span
                    style={{
                      color: "var(--text-dim)",
                      fontSize: 13,
                      transition: "transform 0.2s",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                </button>

                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                    transition: skipAnimation.has(cluster.id) ? "none" : "grid-template-rows 0.25s ease",
                  }}
                >
                  <div style={{ overflow: isOpen ? "visible" : "hidden", minHeight: 0 }}>
                  <div
                    style={{
                      borderLeft: "3px solid var(--claw-red)",
                      margin: "0 16px 12px 30px",
                      paddingLeft: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {cluster.prs.map((item) => (
                      <div key={item.number} style={{ fontSize: 14, lineHeight: 1.6 }}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--claw-red)",
                            textDecoration: "none",
                            fontWeight: 600,
                            marginRight: 6,
                          }}
                        >
                          #{item.number}
                        </a>
                        <span style={{ opacity: item.status === "closed" ? 0.5 : 1, textDecoration: item.status === "closed" ? "line-through" : "none", color: "var(--text-dim)" }}>{item.title}</span>
                        <span style={{ fontSize: 11, color: "#666", marginLeft: 6 }}>
                          {new Date(item.created_at + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        {item.comments > 0 && (
                          <span style={{ fontSize: 11, color: "#666", marginLeft: 4 }}>
                            💬{item.comments}
                          </span>
                        )}
                        {item.status === "closed" && (
                          <span style={{ fontSize: 11, color: "#888", background: "#262626", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>closed</span>
                        )}
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
