import { ReactNode } from "react";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#111114] text-[#ededf0]">{children}</div>;
}
