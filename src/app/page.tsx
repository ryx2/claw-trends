"use client";

import { useState, useEffect, useCallback } from "react";

interface PR {
  number: number;
  title: string;
  url: string;
  status: string;
  created_at: string;
}

interface Cluster {
  id: string;
  label: string;
  count: number;
  prs: PR[];
}

const RANGES = [
  { key: "day", label: "Today" },
  { key: "3days", label: "3 Days" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All Time" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

export default function Home() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeKey>("all");

  const fetchClusters = useCallback(async (r: RangeKey) => {
    try {
      const params = r === "all" ? "" : `?range=${r}`;
      const res = await fetch(`/api/clusters${params}`);
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
    fetchClusters(range);
    const interval = setInterval(() => fetchClusters(range), 30_000);
    return () => clearInterval(interval);
  }, [range, fetchClusters]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 768, margin: "0 auto", padding: "48px 16px" }}>
      {/* Header */}
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 4 }}>
          {"\uD83E\uDD9E"} Claw Trends
        </h1>
        <p style={{ color: "var(--text-dim)", marginBottom: 8 }}>
          Most common PR patterns in OpenClaw
        </p>
        <a
          href="https://github.com/openclaw/openclaw"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--text-dim)", fontSize: 13, textDecoration: "underline" }}
        >
          github.com/openclaw/openclaw
        </a>
      </header>

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
          No PRs found for this time range.
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
                    maxHeight: isOpen ? 1000 : 0,
                    overflow: "hidden",
                    transition: "max-height 0.3s ease",
                  }}
                >
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
                    {cluster.prs.map((pr) => (
                      <div key={pr.number} style={{ fontSize: 14, lineHeight: 1.5, display: "flex", alignItems: "baseline", gap: 6 }}>
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--claw-red)",
                            textDecoration: "none",
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          #{pr.number}
                        </a>
                        <span style={{ opacity: pr.status === "closed" ? 0.5 : 1, textDecoration: pr.status === "closed" ? "line-through" : "none", color: "var(--text-dim)" }}>{pr.title}</span>
                        <span style={{ fontSize: 11, color: "#666", flexShrink: 0, marginLeft: "auto" }}>
                          {new Date(pr.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        {pr.status === "closed" && (
                          <span style={{ fontSize: 11, color: "#888", background: "#262626", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>closed</span>
                        )}
                      </div>
                    ))}
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
