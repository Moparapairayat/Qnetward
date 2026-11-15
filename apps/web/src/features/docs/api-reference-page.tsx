"use client";

import dynamic from "next/dynamic";
import { DocsHeader } from "@/features/docs/docs-shell";

// Scalar reads window and loads its own styles, so it renders in the browser only.
const ApiReference = dynamic(() => import("@/features/docs/api-reference").then((m) => m.ApiReference), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center text-sm text-[var(--d-subtle)]">Loading the API reference…</div>
  ),
});

export function ApiReferencePage() {
  return (
    <>
      <DocsHeader />
      <ApiReference />
    </>
  );
}
