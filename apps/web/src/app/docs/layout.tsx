import { ReactNode } from "react";
import "@/features/docs/docs.css";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <div className="docs-root min-h-screen">{children}</div>;
}
