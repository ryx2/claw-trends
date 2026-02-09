const SIMILARITY_THRESHOLD = 0.82;

export function assignCluster(
  queryResults: { score?: number; metadata?: { cluster_id?: string } }[]
): string {
  if (queryResults.length > 0) {
    const top = queryResults[0];
    if (
      top.score !== undefined &&
      top.score > SIMILARITY_THRESHOLD &&
      top.metadata?.cluster_id
    ) {
      return top.metadata.cluster_id;
    }
  }

  return `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
