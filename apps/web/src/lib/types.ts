export type AuthUser = {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string | null;
  created_at: string;
};

export type UserProfile = {
  bio: string;
  pronouns: string;
  website: string;
  /** IANA zone such as Asia/Dhaka; empty means the browser's zone. */
  timezone: string;
  social_links: string[];
  updated_at?: string;
};

export type UserProfileResponse = {
  profile: UserProfile;
  /** Path of the uploaded avatar, or empty to use initials. */
  avatar_url: string;
  /** Whether this server has file storage for avatar uploads. */
  avatar_uploads: boolean;
};

export type AccountSession = {
  id: number;
  created_at: string;
  expires_at: string;
  user_agent: string;
  ip_address: string;
  current: boolean;
};

export type SessionResponse = {
  authenticated: boolean;
  user?: AuthUser | null;
  mode?: "authenticated" | "demo";
  read_only?: boolean;
  platform_role?: "admin" | "user";
  active_workspace_id?: number;
};

export type AuthMessageResponse = {
  ok: boolean;
  message: string;
  preview_url?: string;
  preview_code?: string;
  verification_required?: boolean;
  authenticated?: boolean;
  user?: AuthUser | null;
  email?: string;
};

export type WorkspaceContext = {
  id: number;
  name: string;
  plan: string;
  billing_status: string;
  role: string;
  member_count: number;
  created_at: string;
};

export type WorkspaceContextResponse = {
  workspace?: WorkspaceContext | null;
};

export type WorkspaceMember = {
  user_id: number;
  name: string;
  email: string;
  role: string;
  joined_at: string;
  is_current: boolean;
};

export type WorkspaceInvitation = {
  id: number;
  workspace_id: number;
  workspace_name?: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  inviter_name: string;
};

export type WorkspaceTeamResponse = {
  workspace?: WorkspaceContext | null;
  members?: WorkspaceMember[];
  invitations?: WorkspaceInvitation[];
};

export type WorkspaceInvitationsResponse = {
  invitations?: WorkspaceInvitation[];
};

export type WorkspaceListResponse = {
  active_workspace_id?: number;
  workspaces?: WorkspaceContext[];
};

export type AdminOverviewResponse = {
  user_count: number;
  verified_user_count: number;
  workspace_count: number;
  invitation_count: number;
  pending_invitation_count: number;
  session_count: number;
};

export type AdminUserSummary = {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string | null;
  created_at: string;
  owned_workspace_count: number;
  workspace_count: number;
  active_session_count: number;
  platform_role: "admin" | "user";
};

export type AdminUsersResponse = {
  users?: AdminUserSummary[];
};

export type AdminWorkspaceSummary = {
  id: number;
  name: string;
  plan: string;
  billing_status: string;
  created_at: string;
  owner_user_id: number;
  owner_name: string;
  owner_email: string;
  member_count: number;
  pending_invitation_count: number;
  active_session_count: number;
};

export type AdminWorkspacesResponse = {
  workspaces?: AdminWorkspaceSummary[];
};

export type AdminSystemResponse = {
  overview: AdminOverviewResponse;
  runtime: {
    database_driver?: string;
    redis_enabled: boolean;
    object_storage_enabled: boolean;
    email_delivery_enabled: boolean;
  };
  features: {
    public_base_url?: string;
    demo_enabled: boolean;
    session_ttl_hours: number;
    configured_admins: number;
  };
};

export type ProbeResult = {
  /** Client-side arrival time (ms since epoch) for streamed results. */
  ts?: number;
  seq?: number;
  addr?: string;
  error?: string;
  rtt?: string;
  rtt_ms?: number;
  port?: number;
  state?: string;
};

export type ProbeSummary = {
  sent?: number;
  recv?: number;
  loss?: number;
  min?: string;
  avg?: string;
  max?: string;
  median?: string;
  stddev?: string;
  jitter?: string;
  loss_streak?: number;
  duration?: string;
  scanned?: number;
  open?: number;
  closed?: number;
  timeout?: number;
};

export type ProbeReport = {
  protocol: string;
  target: string;
  addr?: string;
  port?: number;
  results: ProbeResult[];
  summary: ProbeSummary;
};

export type ProbeStreamEvent = {
  type: "result" | "summary" | "stopped" | "error";
  protocol?: string;
  target?: string;
  addr?: string;
  port?: number;
  ts?: number;
  result?: ProbeResult;
  summary?: ProbeSummary;
  error?: string;
};

export type HistoryPoint = {
  ts: number;
  seq?: number;
  rtt_ms?: number;
  error?: string;
};

export type RecentHistoryTarget = {
  protocol: "ping" | "tcpping";
  target: string;
  port?: number;
  last_sample_at: number;
};

export type DNSStringSection = {
  values?: string[];
  records?: { value: string; ttl: number }[];
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSMXRecord = {
  host: string;
  pref: number;
  ttl: number;
};

export type DNSMXSection = {
  records?: DNSMXRecord[];
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSSOARecord = {
  ns: string;
  mbox: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
  ttl: number;
};

export type DNSSOASection = {
  record?: DNSSOARecord | null;
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSSRVRecord = {
  target: string;
  port: number;
  priority: number;
  weight: number;
  ttl: number;
};

export type DNSSRVSection = {
  records?: DNSSRVRecord[];
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSCAARecord = {
  flag: number;
  tag: string;
  value: string;
  ttl: number;
};

export type DNSCAASection = {
  records?: DNSCAARecord[];
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSReverseRecord = {
  address: string;
  names?: string[];
  records?: { value: string; ttl: number }[];
  error?: string;
  duration_ms: number;
  resolver?: string;
  authoritative?: boolean;
};

export type DNSReport = {
  protocol: string;
  target: string;
  kind: "host" | "ip";
  record_type: string;
  resolver: string;
  a: DNSStringSection;
  aaaa: DNSStringSection;
  cname: DNSStringSection;
  ns: DNSStringSection;
  txt: DNSStringSection;
  dmarc: DNSStringSection;
  mx: DNSMXSection;
  soa: DNSSOASection;
  srv: DNSSRVSection;
  caa: DNSCAASection;
  dnskey: DNSStringSection;
  ds: DNSStringSection;
  rrsig: DNSStringSection;
  ptr?: DNSReverseRecord[];
  analysis: {
    spf_present: boolean;
    dmarc_present: boolean;
    mx_present: boolean;
    caa_present: boolean;
    dnskey_present: boolean;
    ds_present: boolean;
    rrsig_present: boolean;
    dnssec_present: boolean;
    mail_ready: boolean;
  };
  summary: {
    addresses: number;
    reverse_lookups: number;
    total_records: number;
    duration_ms: number;
  };
};

export type AlertRule = {
  id: number;
  name: string;
  protocol: "ping" | "tcpping";
  target: string;
  port?: number | null;
  recipient_email: string;
  latency_threshold_ms?: number | null;
  loss_threshold_percent?: number | null;
  consecutive_breaches: number;
  cooldown_minutes: number;
  notify_on_recovery: boolean;
  enabled: boolean;
  last_state: string;
  current_breach_streak: number;
  last_triggered_at?: string | null;
  last_recovered_at?: string | null;
  last_evaluated_at?: string | null;
  created_at: string;
};

export type AlertRulePayload = {
  id?: number;
  name: string;
  protocol: "ping" | "tcpping";
  target: string;
  port?: number;
  recipient_email?: string;
  latency_threshold_ms?: number;
  loss_threshold_percent?: number;
  consecutive_breaches: number;
  cooldown_minutes: number;
  notify_on_recovery: boolean;
  enabled: boolean;
};

export type MFAChallengeResponse = { mfa_required: true; mfa_token: string; message: string };

export type MFAStatus = { enabled: boolean; enabled_at?: string; recovery_codes_left: number };

export type MFASetupResponse = { secret: string; otpauth_url: string; qr_code: string };

export type MFARecoveryResponse = { recovery_codes: string[] };

export type PlanLimits = {
  monitors: number;
  api_keys: number;
  members: number;
  probes_per_hour: number;
  scans_per_hour: number;
  api_requests_per_minute: number;
};

export type Plan = { id: "free" | "pro" | "enterprise"; name: string; limits: PlanLimits };

export type WorkspaceUsageResponse = {
  plan: Plan;
  plans: Plan[];
  usage: {
    data_region: string;
    monitors: number;
    api_keys: number;
    members: number;
    pending_invitations: number;
    probes_last_hour: number;
    scans_last_hour: number;
  };
};

export type APIKey = {
  id: number;
  created_by?: number;
  creator_name?: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at?: string | null;
  revoked_at?: string | null;
  last_used_at?: string | null;
  last_used_ip?: string;
  created_at: string;
};

export type APIKeyListResponse = { keys: APIKey[]; scopes: string[] };

export type APIKeyCreateResponse = { key: APIKey; token: string };

export type AuditEvent = {
  id: number;
  occurred_at: string;
  actor_user_id?: number;
  actor_email?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  target_label?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
};

export type AuditPage = {
  events: AuditEvent[];
  next_before?: number;
};

export type MonitorCheck = {
  checked_at: string;
  ok: boolean;
  rtt_ms?: number | null;
  loss_percent: number;
  status_code?: number | null;
  error?: string;
};

export type MonitorProtocol = "http" | "tcpping" | "ping";

export type Monitor = {
  id: number;
  name: string;
  protocol: MonitorProtocol;
  target: string;
  port?: number | null;
  interval_seconds: number;
  expected_status?: number | null;
  last_status_code?: number | null;
  tls_expires_at?: string | null;
  notify_email: string;
  enabled: boolean;
  status: "pending" | "up" | "down";
  last_checked_at?: string | null;
  last_status_change_at?: string | null;
  last_rtt_ms?: number | null;
  last_error?: string;
  next_run_at: string;
  created_at: string;
  uptime_24h?: number | null;
  recent_checks: MonitorCheck[];
};

export type MonitorPayload = {
  id?: number;
  name: string;
  protocol: MonitorProtocol;
  target: string;
  port?: number;
  expected_status?: number;
  interval_seconds: number;
  notify_email: string;
  enabled: boolean;
};

export type RuntimeHealthDependency = {
  enabled: boolean;
  healthy: boolean;
  driver?: string;
  error?: string;
};

export type RuntimeHealthResponse = {
  ok: boolean;
  time: string;
  database: RuntimeHealthDependency;
  redis: RuntimeHealthDependency;
  object_storage: RuntimeHealthDependency;
};
