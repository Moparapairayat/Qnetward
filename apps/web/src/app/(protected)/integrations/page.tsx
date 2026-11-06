import { redirect } from "next/navigation";

// Integrations live in workspace settings.
export default function IntegrationsRedirect() {
  redirect("/workspace/integrations");
}
