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
  avatar_url?: string;
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
    /** The latest outcome of sending email on this instance. */
    email_health?: { last_sent_at?: string; last_error?: string; last_error_at?: string };
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
  status_pages: number;
  agents: number;
  /** How many places one monitor may run from. */
  monitor_locations: number;
  watched_domains: number;
  verified_domains: number;
  surface_scans_per_hour: number;
  /** Authorized deep scans in 30 days; 0 means none. */
  deep_scans_per_month: number;
  host_alert_rules: number;
  /** Network devices polled over SNMP. */
  devices: number;
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
  /** The probe agent that ran the check; absent when the server did. */
  agent_id?: number | null;
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
  /** The places the monitor runs from, Qnetward's servers first. */
  locations: MonitorLocation[];
  /** The plan doesn't cover this one now, so it waits. */
  over_plan?: boolean;
};

export type MonitorLocation = {
  /** 0 for Qnetward's servers, otherwise a probe agent's id. */
  agent_id: number;
  name?: string;
  status: "pending" | "up" | "down";
  last_checked_at?: string | null;
  last_rtt_ms?: number | null;
  last_error?: string;
  /** False for an agent that stopped checking in; its result no longer counts. */
  online: boolean;
};

export type MonitorSeriesWindow = "15m" | "1h" | "6h" | "24h";

export type MonitorSeriesPoint = {
  /** Slot start, Unix milliseconds. */
  t: number;
  rtt_ms?: number | null;
  failed: number;
  checks: number;
};

export type MonitorSeries = Pick<Monitor, "id" | "name" | "protocol" | "target" | "port" | "interval_seconds" | "enabled" | "status"> & {
  points: MonitorSeriesPoint[];
};

export type MonitorSeriesResponse = {
  window: MonitorSeriesWindow;
  now: number;
  span_ms: number;
  bucket_seconds: number;
  monitors: MonitorSeries[];
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
  /** Where to run from: 0 for Qnetward's servers, or probe agent ids. */
  locations?: number[];
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

export type ChannelKind = "slack" | "discord" | "telegram" | "webhook";
export type ChannelEvent = "monitors" | "certificates" | "alert_rules" | "agents" | "security" | "hosts";

export type NotificationChannel = {
  id: number;
  kind: ChannelKind;
  name: string;
  /** A masked hint of the destination, such as …9x2k or chat -100123. */
  target: string;
  events: ChannelEvent[];
  enabled: boolean;
  last_sent_at?: string | null;
  last_error?: string;
  created_at: string;
};

export type ChannelListResponse = { channels: NotificationChannel[]; kinds: ChannelKind[]; events: ChannelEvent[] };

export type ChannelSaveResponse = { channel: NotificationChannel; signing_secret?: string };

export type ChannelTestResponse = { ok: boolean; error?: string };

export type BillingPayment = {
  id: number;
  provider: string;
  plan: string;
  months: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  invoice_id?: string;
  transaction_id?: string;
  payment_method?: string;
  created_at: string;
  paid_at?: string | null;
};

/** GET/PUT /api/billing/details: who the workspace's payments are from. */
export type BillingDetails = {
  name: string;
  phone: string;
  company: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
  updated_at?: string;
};

export type PlanPrice = { plan: string; months: number; amount: number };

/** GET /api/plans: the public price list, the same numbers the server enforces and charges. */
export type PublicPlansResponse = {
  currency: string;
  payments_enabled: boolean;
  /** How long probe results are kept, on every plan. */
  history_days: number;
  plans: (Plan & { prices: PlanPrice[] })[];
};

export type BillingResponse = {
  plan: string;
  plan_expires_at?: string | null;
  payments_enabled: boolean;
  prices: { plan: string; months: number; amount: number }[];
  currency: string;
  can_pay: boolean;
  payments?: BillingPayment[];
};

export type StatusPageMonitor = { monitor_id: number; label: string };

export type StatusPage = {
  id: number;
  slug: string;
  title: string;
  description: string;
  published: boolean;
  monitors: StatusPageMonitor[];
  created_at: string;
  updated_at: string;
  /** The plan doesn't cover this one now, so it waits. */
  over_plan?: boolean;
};

export type StatusPageListResponse = { pages: StatusPage[]; limit: number };

export type PublicStatusComponent = {
  name: string;
  status: "up" | "down" | "pending" | "paused";
  last_checked_at?: string | null;
  days: { date: string; checks: number; failed: number }[];
};

export type PublicStatusResponse = {
  page: { slug: string; title: string; description: string; components: PublicStatusComponent[]; updated_at: string };
  status: "operational" | "degraded" | "outage" | "unknown";
  days: number;
};

export type TracerouteHop = {
  ttl: number;
  addr?: string;
  name?: string;
  rtts_ms: number[];
  loss_percent: number;
  best_ms?: number;
  avg_ms?: number;
  worst_ms?: number;
  reached?: boolean;
};

export type TracerouteResult = {
  target: string;
  addr: string;
  ipv6: boolean;
  reached: boolean;
  hops: TracerouteHop[];
  duration_ms: number;
};

export type ProbeAgent = {
  id: number;
  name: string;
  enrolled: boolean;
  enroll_expires_at?: string | null;
  enrolled_at?: string | null;
  last_seen_at?: string | null;
  online: boolean;
  version?: string;
  hostname?: string;
  platform?: string;
  remote_ip?: string;
  created_at: string;
};

export type ProbeAgentListResponse = { agents: ProbeAgent[]; limit: number };

export type ProbeAgentCreateResponse = { agent: ProbeAgent; enroll_token: string; expires_at: string };

export type Severity = "high" | "medium" | "low" | "info" | "pass";
export type FindingCategory = "tls" | "http" | "email" | "dns";

export type SecurityFinding = {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail?: string;
  fix?: string;
};

export type PassiveReport = {
  domain: string;
  grade: string;
  score: number;
  counts: Record<Severity, number>;
  findings: SecurityFinding[];
  tls: {
    available: boolean;
    version?: string;
    cipher?: string;
    trusted: boolean;
    trust_error?: string;
    legacy_accepted: boolean;
    error?: string;
    cert?: {
      subject: string;
      issuer: string;
      names: string[];
      not_before: string;
      not_after: string;
      days_left: number;
      key_type: string;
      key_bits?: number;
      signature_algorithm: string;
    };
  };
  http: { final_url?: string; status_code?: number; redirects_to_https?: boolean; headers?: Record<string, string>; error?: string };
  dns: {
    addresses: string[];
    mx: string[];
    spf: string[];
    dmarc?: string;
    dmarc_from?: string;
    caa: string[];
    caa_from?: string;
    dnssec: boolean;
    org_domain: string;
    lookup_errors?: string[];
  };
  checked_at: string;
  duration_ms: number;
};

export type SecurityScan = {
  id: number;
  kind: "passive" | "surface" | "deep";
  status: "running" | "done" | "failed";
  error?: string;
  domain: string;
  grade: string;
  score: number;
  high: number;
  medium: number;
  low: number;
  created_at: string;
  report?: PassiveReport;
};

export type SecurityWatch = {
  id: number;
  /** passive re-runs a passive check; surface an attack surface scan. */
  kind: "passive" | "surface";
  domain: string;
  interval_hours: 6 | 24 | 168;
  notify_email: string;
  enabled: boolean;
  last_scan_id?: number | null;
  last_grade?: string;
  last_score?: number | null;
  last_checked_at?: string | null;
  last_error?: string;
  next_run_at: string;
  created_at: string;
};

export type SecurityWatchListResponse = { watches: SecurityWatch[]; limit: number; intervals: number[] };

export type VerifiedDomain = {
  id: number;
  domain: string;
  token: string;
  status: "pending" | "verified" | "lapsed";
  method?: "dns" | "http" | "";
  verified_at?: string | null;
  last_seen_at?: string | null;
  last_checked_at?: string | null;
  last_error?: string;
  next_check_at: string;
  created_at: string;
  /** Where the TXT record goes, like _qnetward-verify.example.com. */
  record_name: string;
  /** Where the proof file goes. */
  file_url: string;
};

export type VerifiedDomainListResponse = { domains: VerifiedDomain[]; limit: number };

export type SurfaceHost = {
  name: string;
  source: string;
  addresses: string[];
  cname?: string;
  private?: boolean;
  open_ports: number[];
  tls_version?: string;
  cert_expiry?: string | null;
  cert_issuer?: string;
  services?: { port: number; banner?: string; product?: string; version?: string; cpe?: string }[];
};

export type SurfaceFinding = SecurityFinding & { host: string };

export type SurfaceReport = {
  domain: string;
  grade: string;
  score: number;
  counts: Record<Severity, number>;
  findings: SurfaceFinding[];
  hosts: SurfaceHost[];
  truncated?: boolean;
  ct_error?: string;
  vulns?: VulnView[];
  vuln_error?: string;
  checked_at: string;
  duration_ms: number;
};

export type VulnSeverity = "critical" | "high" | "medium" | "low";

export type VulnView = {
  cve: string;
  severity: VulnSeverity;
  cvss: number;
  kev: boolean;
  epss: number;
  summary: string;
  published?: string;
  url: string;
  host: string;
  port: number;
  product: string;
  version: string;
  domain: string;
  scan_id: number;
  scanned_at: string;
  disposition?: { id: number; host: string; cve: string; status: "accepted" | "false_positive"; reason?: string; created_at: string } | null;
};

export type VulnListResponse = {
  vulns: VulnView[];
  domains: { domain: string; scan_id: number; scanned_at: string; vuln_error?: string }[];
};

export type DeepScanRequest = {
  id: number;
  workspace_id: number;
  workspace_name?: string;
  domain: string;
  hosts: string[];
  checks: string[];
  window_start: string;
  window_end: string;
  consent_version: string;
  consent_text: string;
  consent_hash: string;
  consent_name: string;
  consent_ip?: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "running" | "completed" | "failed" | "expired";
  reviewer_email?: string;
  reviewed_at?: string | null;
  review_note?: string;
  scan_id?: number | null;
  created_at: string;
};

export type DeepScanListResponse = { requests: DeepScanRequest[]; per_month: number; windows: number[]; checks: Record<string, string> };

export type DeepScanPreview = {
  text: string;
  hash: string;
  version: string;
  input: { domain: string; hosts: string[]; checks: string[]; window_start: string; window_hours: number; name: string };
};

export type DeepReport = {
  domain: string;
  hosts: string[];
  checks: string[];
  grade: string;
  score: number;
  counts: Record<Severity, number>;
  findings: (SecurityFinding & { host: string; url: string })[];
  requests: number;
  skipped?: string[];
  checked_at: string;
  duration_ms: number;
};

export type ComplianceStatus = "pass" | "warn" | "fail" | "not_assessed";

export type ComplianceEvidence = {
  kind?: string;
  domain?: string;
  host?: string;
  id: string;
  title: string;
  severity: string;
  scan_id?: number;
  at: string;
};

export type ComplianceControl = {
  id: string;
  title: string;
  description: string;
  area: string;
  refs: Record<string, string[]>;
  fix: string;
  status: ComplianceStatus;
  summary: string;
  evidence: ComplianceEvidence[];
  domains: string[];
};

export type ComplianceReport = {
  frameworks: { id: string; name: string; short: string; mapped: number; assessed: number; passing: number; warning: number; failing: number; not_assessed: number; percent: number }[];
  controls: ComplianceControl[];
  counts: Record<ComplianceStatus, number>;
  sources: { kind: string; domain: string; scan_id: number; at: string }[];
  window_days: number;
  checked_at: string;
};

export type HostDisk = { mount: string; fstype: string; used: number; total: number };

export type HostSample = {
  at: string;
  cpu: number;
  load1: number;
  load5: number;
  load15: number;
  mem_used: number;
  mem_total: number;
  swap_used: number;
  swap_total: number;
  disks: HostDisk[];
  net_rx_bps: number;
  net_tx_bps: number;
  procs: number;
  uptime: number;
};

export type Host = ProbeAgent & { info?: Record<string, unknown> | null; latest?: HostSample | null; latest_at?: string | null };

export type HostListResponse = { hosts: Host[]; metrics_seconds: number };

export type HostPoint = {
  at: string;
  cpu: number;
  cpu_max: number;
  load1: number;
  mem_pct: number;
  swap_pct: number;
  disk_pct: number;
  net_rx_bps: number;
  net_tx_bps: number;
  procs: number;
};

export type HostSeriesResponse = { points: HostPoint[]; range: string; bucket_seconds: number };

export type HostMetric = "cpu" | "memory" | "disk" | "swap";

export type HostAlertRule = {
  id: number;
  agent_id: number | null;
  metric: HostMetric;
  threshold: number;
  minutes: number;
  notify_email: string;
  enabled: boolean;
  created_at: string;
  firing: { agent_id: number; firing_since: string; value: number }[];
  /** The plan doesn't cover this one now, so it waits. */
  over_plan?: boolean;
};

export type HostAlertRuleList = { rules: HostAlertRule[]; limit: number };

export type DeviceInterface = {
  index: number;
  name: string;
  descr: string;
  alias: string;
  type: number;
  admin: string;
  oper: string;
  speed_bps: number;
  in_bps: number;
  out_bps: number;
  in_errors_ps: number;
  out_errors_ps: number;
  in_discards_ps: number;
  out_discards_ps: number;
  has_rates: boolean;
};

export type NetworkDevice = {
  id: number;
  agent_id: number | null;
  agent_name?: string;
  agent_online: boolean;
  name: string;
  address: string;
  port: number;
  version: "2c" | "3";
  interval_seconds: number;
  enabled: boolean;
  status: "unknown" | "up" | "down";
  last_polled_at?: string | null;
  last_error?: string;
  sys?: { descr: string; object_id: string; uptime_s: number; name: string; location: string; contact: string } | null;
  interfaces?: DeviceInterface[] | null;
  created_at: string;
  credentials: { community_set?: boolean; username?: string; auth_protocol?: string; priv_protocol?: string };
  /** The plan doesn't cover this one now, so it waits. */
  over_plan?: boolean;
};

export type DeviceListResponse = { devices: NetworkDevice[]; limit: number };

export type DevicePoint = { at: string; in_bps: number; out_bps: number; errors_ps: number; rtt_ms?: number; up: number };

export type DeviceSeriesResponse = { points: DevicePoint[]; range: string; bucket_seconds: number };
