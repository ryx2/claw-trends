import { Pinecone } from "@pinecone-database/pinecone";
import { PRMetadata } from "./types";

let client: Pinecone | null = null;

function getClient(): Pinecone {
  if (!client) {
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }
  return client;
}

export function getIndex() {
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    throw new Error("PINECONE_INDEX_NAME environment variable is not set");
  }
  return getClient().index(indexName);
}

export async function upsertPR(
  id: string,
  vector: number[],
  metadata: PRMetadata
) {
  const index = getIndex();
  await index.upsert({
    records: [{ id, values: vector, metadata: metadata as unknown as Record<string, string | number> }],
  });
}

export async function querySimilar(vector: number[], topK = 3) {
  const index = getIndex();
  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
  });
  return result.matches || [];
}

export async function fetchAllPRs(): Promise<PRMetadata[]> {
  const index = getIndex();
  const allMetadata: PRMetadata[] = [];

  let paginationToken: string | undefined;

  do {
    const listResult = await index.listPaginated({
      paginationToken,
    });

    const ids = (listResult.vectors || []).map((v) => v.id!);

    if (ids.length > 0) {
      const fetchResult = await index.fetch({ ids });
      for (const record of Object.values(fetchResult.records || {})) {
        if (record?.metadata) {
          allMetadata.push(record.metadata as unknown as PRMetadata);
        }
      }
    }

    paginationToken = listResult.pagination?.next;
  } while (paginationToken);

  return allMetadata;
}
