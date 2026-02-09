import type { Metadata } from "next";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Claw Trends — OpenClaw PR Pattern Tracker",
  description:
    "Track the most common pull request patterns in the OpenClaw repo. PRs are clustered by semantic similarity using Voyage AI embeddings. Filter by today, this week, this month, or all time.",
  metadataBase: new URL("https://openclawoverview.com"),
  openGraph: {
    title: "Claw Trends — OpenClaw PR Pattern Tracker",
    description:
      "See which issues keep popping up in OpenClaw. PRs are auto-clustered by similarity and ranked by frequency.",
    url: "https://openclawoverview.com",
    siteName: "Claw Trends",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Claw Trends — OpenClaw PR Pattern Tracker",
    description:
      "See which issues keep popping up in OpenClaw. PRs are auto-clustered by similarity and ranked by frequency.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <Providers>
          <Suspense>{children}</Suspense>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
