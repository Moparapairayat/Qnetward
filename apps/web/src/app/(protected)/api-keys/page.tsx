import { redirect } from "next/navigation";

// API keys live in workspace settings.
export default function APIKeysRedirect() {
  redirect("/workspace/api-keys");
}
