import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { featurePreviews, previewBySlug } from "@/features/previews/feature-previews";
import { PreviewPage } from "@/features/previews/preview-page";

// Planned features render as UI previews until each one gets its own route.
export function generateStaticParams() {
  return featurePreviews.map((f) => ({ feature: f.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ feature: string }> }): Promise<Metadata> {
  const { feature } = await params;
  return { title: previewBySlug.get(feature)?.title ?? "Preview" };
}

export default async function FeaturePreviewRoute({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const preview = previewBySlug.get(feature);
  if (!preview) notFound();
  return <PreviewPage feature={preview} />;
}
