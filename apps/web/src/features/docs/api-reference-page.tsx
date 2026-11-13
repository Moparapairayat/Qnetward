"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight, Download, KeyRound } from "@/components/icons";
import { QnetwardMark } from "@/features/landing/qnetward-mark";

// Scalar reads window and loads its own styles, so it renders in the browser only.
const ApiReference = dynamic(() => import("@/features/docs/api-reference").then((m) => m.ApiReference), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center text-sm text-[#71717a]">Loading the API reference…</div>
  ),
});

export function ApiReferencePage() {
  return (
    <>
      <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-white/[0.08] bg-[#0d0d10]/95 px-4 backdrop-blur sm:px-5">
        <Link href="/" className="flex items-center gap-2" aria-label="Qnetward home">
          <QnetwardMark size={24} />
          <span className="text-md font-semibold tracking-tight">Qnetward</span>
        </Link>
        <span className="h-4 w-px bg-white/15" aria-hidden />
        <span className="text-base text-[#a1a1aa]">API reference</span>
        <span className="hidden rounded-md border border-white/10 px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-2xs text-[#a1a1aa] sm:inline">v1</span>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/workspace/api-keys" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[#a1a1aa] hover:bg-white/[0.05] hover:text-[#ededf0] sm:inline-flex">
            <KeyRound className="h-3.5 w-3.5" /> Get an API key
          </Link>
          <a href="/openapi.yaml" download className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[#a1a1aa] hover:bg-white/[0.05] hover:text-[#ededf0] md:inline-flex">
            <Download className="h-3.5 w-3.5" /> OpenAPI
          </a>
          <Link href="/overview" className="inline-flex items-center gap-1 rounded-lg bg-[#ff3d7f] px-3 py-1.5 font-medium text-white hover:bg-[#ff5a93]">
            Console <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </header>
      <ApiReference />
    </>
  );
}
