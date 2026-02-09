export interface PR {
  number: number;
  title: string;
  body: string;
  url: string;
  created_at: string;
  user: string;
  comments: number;
}

export interface PRMetadata {
  pr_number: number;
  title: string;
  url: string;
  cluster_id: string;
  created_at: string;
}

export interface Cluster {
  id: string;
  label: string;
  count: number;
  prs: { number: number; title: string; url: string }[];
}
