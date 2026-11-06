/** Plan names as customers know them; older rows say "starter" for Free. */
export function planLabel(plan?: string | null) {
  const id = (plan ?? "").toLowerCase();
  return id === "pro" ? "Pro" : id === "enterprise" ? "Enterprise" : "Free";
}
