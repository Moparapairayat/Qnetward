import { ReactNode } from "react";
import { DocsShell } from "@/features/docs/docs-shell";

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
