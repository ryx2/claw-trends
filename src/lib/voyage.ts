const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";

export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY environment variable is not set");
  }

  const res = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: "voyage-3-lite",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}
