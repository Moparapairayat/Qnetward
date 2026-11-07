import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicStatusResponse } from "@/lib/types";
import { PublicStatusPage } from "@/features/status-pages/public-status-page";

const backendBase = process.env.QNETWARD_BACKEND_URL ?? process.env.NETWATCHER_BACKEND_URL ?? "http://127.0.0.1:8080";

async function load(slug: string): Promise<PublicStatusResponse | null> {
  const res = await fetch(`${backendBase}/api/public/status/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`status page ${slug}: ${res.status}`);
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) return { title: "Status page not found" };
  const summary = data.status === "operational" ? "All systems operational" : data.status === "outage" ? "Major outage" : data.status === "degraded" ? "Some systems down" : "Status";
  return { title: `${data.page.title} · ${summary}`, description: data.page.description || `Live status for ${data.page.title}.` };
}

export default async function StatusPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <PublicStatusPage data={data} />;
}
