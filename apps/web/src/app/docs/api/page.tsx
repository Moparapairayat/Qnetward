import type { Metadata } from "next";
import { ApiReferencePage } from "@/features/docs/api-reference-page";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every Qnetward endpoint, with request and response examples in curl, JavaScript, Python, and Go, and a console to try them with your API key.",
};

export default function ApiDocsPage() {
  return <ApiReferencePage />;
}
