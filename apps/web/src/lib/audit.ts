import type { AuditEvent } from "@/lib/types";

/** Plain-language summary of an audit event, without the actor. */
export function describeAuditEvent(event: AuditEvent): string {
  const label = event.target_label || event.target_id || "";
  const meta = event.metadata ?? {};
  const role = typeof meta.role === "string" ? meta.role : "";
  switch (event.action) {
    case "auth.login":
      return "Signed in";
    case "auth.login_failed":
      return "Failed sign-in attempt";
    case "auth.logout":
      return "Signed out";
    case "auth.email_verified":
      return "Verified email address";
    case "account.password_changed":
      return "Changed password";
    case "account.sessions_revoked": {
      const count = typeof meta.count === "number" ? meta.count : 0;
      return `Signed out ${count} other ${count === 1 ? "session" : "sessions"}`;
    }
    case "account.session_revoked":
      return "Signed out a session";
    case "member.invited":
      return `Invited ${label}${role ? ` as ${role}` : ""}`;
    case "member.invitation_revoked":
      return `Revoked the invitation for ${label}`;
    case "member.joined":
      return `Joined the workspace${role ? ` as ${role}` : ""}`;
    case "member.role_changed":
      return `Changed ${label || "a member"} to ${role}`;
    case "member.removed":
      return `Removed ${label || "a member"} from the workspace`;
    case "monitor.created":
      return `Created monitor ${label}`;
    case "monitor.updated":
      return meta.enabled === false ? `Updated monitor ${label} (paused)` : `Updated monitor ${label}`;
    case "monitor.deleted":
      return "Deleted a monitor";
    case "alert_rule.created":
      return `Created alert rule ${label}`;
    case "alert_rule.updated":
      return meta.enabled === false ? `Updated alert rule ${label} (paused)` : `Updated alert rule ${label}`;
    case "alert_rule.deleted":
      return "Deleted an alert rule";
    case "scan.portscan":
      return `Port-scanned ${label}`;
    case "history.exported":
      return `Exported history for ${label}`;
    case "apikey.created":
      return `Created API key ${label}`;
    case "apikey.revoked":
      return `Revoked API key ${label}`;
    default:
      return event.action;
  }
}

/** Extra detail worth showing next to the summary, if any. */
export function auditEventDetail(event: AuditEvent): string | null {
  const meta = event.metadata ?? {};
  switch (event.action) {
    case "monitor.created":
    case "monitor.updated":
    case "alert_rule.created":
    case "alert_rule.updated":
      return typeof meta.target === "string" && meta.target !== event.target_label ? meta.target : null;
    case "scan.portscan":
      return typeof meta.spec === "string" && meta.spec ? `ports ${meta.spec}` : null;
    case "apikey.created":
      return typeof meta.scopes === "string" ? `scopes ${meta.scopes.replaceAll(",", ", ")}` : null;
    case "history.exported":
      return [meta.format, typeof meta.points === "number" ? `${meta.points} samples` : null].filter(Boolean).join(" · ") || null;
    default:
      return null;
  }
}

/** Shortens a user agent to "Browser on OS" for display. */
export function shortUserAgent(ua?: string): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|Go-http|python/i.test(ua) ? "Script" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
