"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Globe, Search } from "@/components/icons";
import { useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, ApiError } from "@/lib/api";
import { DNSReport } from "@/lib/types";
import { formatMs } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";

const resolverOptions = [
  { value: "auto", label: "System resolver" },
  { value: "cloudflare", label: "Cloudflare 1.1.1.1" },
  { value: "google", label: "Google 8.8.8.8" },
  { value: "quad9", label: "Quad9 9.9.9.9" },
  { value: "custom", label: "Custom…" },
] as const;

const recordTypeOptions = ["all", "a", "aaaa", "cname", "ns", "mx", "txt", "dmarc", "soa", "srv", "caa", "dnskey", "ds", "rrsig", "ptr"] as const;
const recordSectionTypes = ["a", "aaaa", "cname", "ns", "mx", "txt", "dmarc", "soa", "srv", "caa", "dnskey", "ds", "rrsig"] as const;

const schema = z
  .object({
    target: z.string().trim().min(1, "Target is required"),
    timeout_ms: z.coerce.number().min(100).max(10000),
    record_type: z.enum(recordTypeOptions),
    resolver: z.enum(["auto", "cloudflare", "google", "quad9", "custom"]),
    custom_resolver: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.resolver === "custom" && !value.custom_resolver) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom resolver is required",
        path: ["custom_resolver"],
      });
    }
  });

type DNSLookupFormValues = z.output<typeof schema>;
type DNSLookupFormInput = z.input<typeof schema>;
type RecordItem = { value: string; ttl?: number };

function sectionError(report: DNSReport, sectionType: (typeof recordSectionTypes)[number]) {
  switch (sectionType) {
    case "a":
      return report.a.error;
    case "aaaa":
      return report.aaaa.error;
    case "cname":
      return report.cname.error;
    case "ns":
      return report.ns.error;
    case "mx":
      return report.mx.error;
    case "txt":
      return report.txt.error;
    case "dmarc":
      return report.dmarc.error;
    case "soa":
      return report.soa.error;
    case "srv":
      return report.srv.error;
    case "caa":
      return report.caa.error;
    case "dnskey":
      return report.dnskey.error;
    case "ds":
      return report.ds.error;
    case "rrsig":
      return report.rrsig.error;
  }
}

function queriedSectionCount(selectedType: string) {
  if (selectedType === "all") {
    return recordSectionTypes.length + 1;
  }
  if (selectedType === "ptr") {
    return 1;
  }
  return 1;
}

function failedSectionCount(report: DNSReport, selectedType: string) {
  if (selectedType === "ptr") {
    return (report.ptr ?? []).some((item) => item.error) ? 1 : 0;
  }
  if (selectedType !== "all") {
    return isVisibleSection(selectedType, "ptr")
      ? (report.ptr ?? []).some((item) => item.error)
        ? 1
        : 0
      : sectionError(report, selectedType as (typeof recordSectionTypes)[number])
        ? 1
        : 0;
  }

  let failed = recordSectionTypes.filter((section) => sectionError(report, section)).length;
  if ((report.ptr ?? []).some((item) => item.error)) {
    failed += 1;
  }
  return failed;
}

function sectionMeta(durationMs: number, resolver?: string, authoritative?: boolean, extra?: string) {
  const meta = [formatMs(durationMs)];
  if (resolver) {
    meta.push(resolver);
  }
  if (authoritative) {
    meta.push("AA");
  }
  if (extra) {
    meta.push(extra);
  }
  return meta.join(" · ");
}

function isVisibleSection(selectedType: string, sectionType: string) {
  return selectedType === "all" || selectedType === sectionType;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
      style={
        ok
          ? { borderColor: "rgba(74,222,128,0.3)", color: "#86efac", background: "rgba(74,222,128,0.08)" }
          : { borderColor: "var(--lp-border)", color: "var(--lp-subtle)" }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? "#4ade80" : "#85858e" }} />
      {label}
    </span>
  );
}

function DNSRecordSection({ title, meta, items, error }: { title: string; meta: string; items: RecordItem[]; error?: string }) {
  return (
    <section className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a]">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
        <h3 className="text-sm font-medium">
          {title}
          <span className="ml-2 text-xs font-normal text-[var(--lp-subtle)]">{items.length}</span>
        </h3>
        <span className="truncate text-2xs text-[var(--lp-subtle)]">{meta}</span>
      </div>
      <div className="p-2 pt-2.5">
        {items.length === 0 && !error ? <p className="px-2 py-2 text-sm text-[var(--lp-subtle)]">No records returned.</p> : null}
        {items.map((item) => (
          <div key={`${item.value}-${item.ttl ?? 0}`} className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
            <span className="lp-mono break-all text-xs text-[var(--lp-text)]">{item.value}</span>
            {typeof item.ttl === "number" ? <span className="lp-mono shrink-0 text-2xs text-[var(--lp-subtle)]">TTL {item.ttl}s</span> : null}
          </div>
        ))}
        {error ? (
          <p className="m-1 rounded-md border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2 text-xs text-[#ff8fb3]">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function DNSInspectorWorkspace() {
  const [report, setReport] = useState<DNSReport | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<DNSLookupFormInput, unknown, DNSLookupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      target: "",
      timeout_ms: 3000,
      record_type: "all",
      resolver: "auto",
      custom_resolver: "",
    },
  });

  const lookup = useMutation({
    mutationFn: (values: DNSLookupFormValues) => {
      const resolver = values.resolver === "custom" ? (values.custom_resolver ?? "").trim() : values.resolver;
      return apiRequest<DNSReport>("/api/dnslookup", {
        method: "POST",
        body: JSON.stringify({
          target: values.target,
          timeout_ms: values.timeout_ms,
          record_type: values.record_type,
          resolver,
        }),
      });
    },
    onSuccess: (data) => {
      setFormError(null);
      setReport(data);
    },
    onError: (error: ApiError) => setFormError(error.message),
  });

  const summary = useMemo(() => {
    if (!report) {
      return null;
    }
    const effectiveSelectedType = report.record_type.toLowerCase();
    const totalSections = queriedSectionCount(effectiveSelectedType);
    const failedSections = failedSectionCount(report, effectiveSelectedType);
    const healthySections = totalSections - failedSections;
    return {
      healthySections,
      failedSections,
      totalSections,
      ptrCount: (report.ptr ?? []).reduce((total, item) => total + (item.records?.length ?? item.names?.length ?? 0), 0),
      srvCount: report.srv.records?.length ?? 0,
      caaCount: report.caa.records?.length ?? 0,
      auditMode: report.record_type === "ALL" ? "Complete" : "Partial",
    };
  }, [report]);

  const watchedRecordType = useWatch({ control: form.control, name: "record_type" });
  const watchedResolver = useWatch({ control: form.control, name: "resolver" });
  const selectedType = (report?.record_type ?? watchedRecordType ?? "all").toLowerCase();
  const showCustomResolver = watchedResolver === "custom";
  const searchParams = useSearchParams();
  useEffect(() => {
    const target = searchParams.get("target")?.trim();
    if (target) form.setValue("target", target);
  }, [form, searchParams]);
  const errors = form.formState.errors;

  const sections = report
    ? [
        {
          key: "a",
          title: "A",
          meta: sectionMeta(report.a.duration_ms, report.a.resolver, report.a.authoritative),
          items: (report.a.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.a.error,
        },
        {
          key: "aaaa",
          title: "AAAA",
          meta: sectionMeta(report.aaaa.duration_ms, report.aaaa.resolver, report.aaaa.authoritative),
          items: (report.aaaa.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.aaaa.error,
        },
        {
          key: "cname",
          title: "CNAME",
          meta: sectionMeta(report.cname.duration_ms, report.cname.resolver, report.cname.authoritative),
          items: (report.cname.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.cname.error,
        },
        {
          key: "ns",
          title: "NS",
          meta: sectionMeta(report.ns.duration_ms, report.ns.resolver, report.ns.authoritative),
          items: (report.ns.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.ns.error,
        },
        {
          key: "mx",
          title: "MX",
          meta: sectionMeta(report.mx.duration_ms, report.mx.resolver, report.mx.authoritative),
          items: (report.mx.records ?? []).map((i) => ({ value: `${i.pref} ${i.host}`, ttl: i.ttl })),
          error: report.mx.error,
        },
        {
          key: "txt",
          title: "TXT",
          meta: sectionMeta(report.txt.duration_ms, report.txt.resolver, report.txt.authoritative),
          items: (report.txt.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.txt.error,
        },
        {
          key: "dmarc",
          title: "DMARC",
          meta: sectionMeta(report.dmarc.duration_ms, report.dmarc.resolver, report.dmarc.authoritative),
          items: (report.dmarc.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.dmarc.error,
        },
        {
          key: "soa",
          title: "SOA",
          meta: sectionMeta(report.soa.duration_ms, report.soa.resolver, report.soa.authoritative),
          items: report.soa.record
            ? [
                {
                  value: `${report.soa.record.ns} ${report.soa.record.mbox} serial ${report.soa.record.serial} refresh ${report.soa.record.refresh}`,
                  ttl: report.soa.record.ttl,
                },
              ]
            : [],
          error: report.soa.error,
        },
        {
          key: "srv",
          title: "SRV",
          meta: sectionMeta(report.srv.duration_ms, report.srv.resolver, report.srv.authoritative),
          items: (report.srv.records ?? []).map((i) => ({ value: `${i.priority} ${i.weight} ${i.port} ${i.target}`, ttl: i.ttl })),
          error: report.srv.error,
        },
        {
          key: "caa",
          title: "CAA",
          meta: sectionMeta(report.caa.duration_ms, report.caa.resolver, report.caa.authoritative),
          items: (report.caa.records ?? []).map((i) => ({ value: `${i.flag} ${i.tag} "${i.value}"`, ttl: i.ttl })),
          error: report.caa.error,
        },
        {
          key: "dnskey",
          title: "DNSKEY",
          meta: sectionMeta(report.dnskey.duration_ms, report.dnskey.resolver, report.dnskey.authoritative),
          items: (report.dnskey.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.dnskey.error,
        },
        {
          key: "ds",
          title: "DS",
          meta: sectionMeta(report.ds.duration_ms, report.ds.resolver, report.ds.authoritative),
          items: (report.ds.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.ds.error,
        },
        {
          key: "rrsig",
          title: "RRSIG",
          meta: sectionMeta(report.rrsig.duration_ms, report.rrsig.resolver, report.rrsig.authoritative),
          items: (report.rrsig.records ?? []).map((i) => ({ value: i.value, ttl: i.ttl })),
          error: report.rrsig.error,
        },
      ].filter((section) => isVisibleSection(selectedType, section.key) && (selectedType !== "all" || section.items.length > 0 || section.error))
    : [];
  const emptySections = report && selectedType === "all" ? recordSectionTypes.filter((t) => !sections.some((s) => s.key === t)) : [];

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="DNS lookup"
        description="Query every record type, or just one, against the resolver you choose. TTLs, authority, DNSSEC, and mail policy included."
        status={
          <RunStatus
            tone={lookup.isPending ? "live" : report ? "done" : formError ? "error" : "idle"}
            label={lookup.isPending ? "Resolving" : report ? "Done" : formError ? "Error" : "Idle"}
          />
        }
      />

      <form className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-4" onSubmit={form.handleSubmit((values) => lookup.mutate(values))}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_200px_auto] md:items-end">
          <Field label="Domain or IP" error={errors.target?.message}>
            <input
              id="dns-target"
              className="h-10 w-full px-3"
              placeholder="example.com, 8.8.8.8, _sip._tcp.example.com"
              autoComplete="off"
              {...form.register("target")}
            />
          </Field>
          <Field label="Record type">
            <select id="dns-record-type" className="h-10 w-full px-2" {...form.register("record_type")}>
              {recordTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All types" : option.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Resolver">
            <select id="dns-resolver" className="h-10 w-full px-2" {...form.register("resolver")}>
              {resolverOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="console-btn console-btn-primary h-10 px-5" disabled={lookup.isPending}>
            <Search className="h-3.5 w-3.5" /> {lookup.isPending ? "Resolving…" : "Look up"}
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_200px_auto]">
          {showCustomResolver ? (
            <Field label="Custom resolver" hint="host, IPv4, IPv6, or host:port" error={errors.custom_resolver?.message} className="md:col-start-3">
              <input className="h-9 w-full px-3" placeholder="9.9.9.9:53" {...form.register("custom_resolver")} />
            </Field>
          ) : null}
          <Field
            label="Timeout (ms)"
            error={errors.timeout_ms?.message}
            className={showCustomResolver ? "md:col-start-2 md:row-start-1" : "md:col-start-2"}
          >
            <input type="number" className="h-9 w-full px-3" {...form.register("timeout_ms", { valueAsNumber: true })} />
          </Field>
        </div>
        {formError ? (
          <p className="mt-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-sm text-[#ff8fb3]">
            {formError}
          </p>
        ) : null}
      </form>

      {!report ? (
        <div className="rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-14 text-center">
          <Globe className="mx-auto h-5 w-5 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-sm text-[var(--lp-muted)]">Look up a domain to see its records</p>
          <p className="mt-1 text-xs text-[var(--lp-subtle)]">Choose “All types” for a full audit, including mail and DNSSEC posture.</p>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: "Target", value: report.target },
              { label: "Query", value: report.record_type },
              { label: "Resolver", value: report.resolver || "system" },
              { label: "Records", value: String(report.summary.total_records) },
              { label: "Failed sections", value: String(summary?.failedSections ?? 0), tone: summary?.failedSections ? "warn" : "good" },
              { label: "Duration", value: formatMs(report.summary.duration_ms) },
            ]}
          />

          {selectedType === "all" ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
              <Panel title="Mail" aside={<Check ok={report.analysis.mail_ready} label={report.analysis.mail_ready ? "Ready" : "Needs review"} />}>
                <div className="flex flex-wrap gap-2">
                  <Check ok={report.analysis.mx_present} label="MX" />
                  <Check ok={report.analysis.spf_present} label="SPF" />
                  <Check ok={report.analysis.dmarc_present} label="DMARC" />
                  <Check ok={report.analysis.caa_present} label="CAA" />
                </div>
                <p className="mt-3 text-xs text-[var(--lp-subtle)]">
                  {report.analysis.mail_ready
                    ? "MX, SPF, and DMARC are all published."
                    : "A domain that sends mail should publish MX, SPF, and DMARC records."}
                </p>
              </Panel>
              <Panel
                title="DNSSEC"
                aside={<Check ok={report.analysis.dnssec_present} label={report.analysis.dnssec_present ? "Signed" : "Not signed"} />}
              >
                <div className="flex flex-wrap gap-2">
                  <Check ok={report.analysis.dnskey_present} label="DNSKEY" />
                  <Check ok={report.analysis.ds_present} label="DS" />
                  <Check ok={report.analysis.rrsig_present} label="RRSIG" />
                </div>
                <p className="mt-3 text-xs text-[var(--lp-subtle)]">
                  {report.analysis.dnssec_present
                    ? "Signatures were returned for this zone."
                    : "No DNSSEC records were returned, so answers can't be validated."}
                </p>
              </Panel>
            </div>
          ) : null}

          {sections.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 [&>*]:min-w-0">
              {sections.map((section) => (
                <DNSRecordSection key={section.key} title={section.title} meta={section.meta} items={section.items} error={section.error} />
              ))}
            </div>
          ) : null}
          {emptySections.length ? (
            <p className="text-xs text-[var(--lp-subtle)]">No records for: {emptySections.map((t) => t.toUpperCase()).join(", ")}.</p>
          ) : null}

          {selectedType === "all" || selectedType === "ptr" ? (
            (report.ptr ?? []).length ? (
              <DNSRecordSection
                title="Reverse DNS (PTR)"
                meta={`${report.summary.reverse_lookups} lookups`}
                items={(report.ptr ?? []).flatMap((item) =>
                  (item.records ?? []).map((record) => ({ value: `${item.address} → ${record.value}`, ttl: record.ttl })),
                )}
                error={(report.ptr ?? []).find((item) => item.error)?.error}
              />
            ) : null
          ) : null}
        </>
      )}
    </div>
  );
}
