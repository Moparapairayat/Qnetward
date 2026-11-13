"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsFetching, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { AlertRule, HistoryPoint, RecentHistoryTarget, RuntimeHealthResponse, SessionResponse } from "@/lib/types";
import { LiveTelemetrySample, subscribeLiveTelemetry } from "@/lib/live-telemetry";
import {
  buildOverviewTargetSnapshots,
  uniqueAlertTargets,
} from "@/features/overview/overview-helpers";
import { buildOverviewDemoData } from "@/features/overview/overview-demo-data";
import { GettingStarted } from "@/features/overview/overview-view";
import { ComingNext, ResponseTimeChart, StatCards, TargetHealthCard, TargetsSummary, WelcomeHeader } from "@/features/overview/overview-dashboard";
import { MonitorResponseChart } from "@/features/overview/monitor-response-chart";
import { useLiveInterval } from "@/lib/live";
import { Skeleton } from "@/components/ui/skeleton";

function mergeTrackedRules(alertRules: AlertRule[], recentTargets: RecentHistoryTarget[]) {
  const merged = new Map<string, AlertRule>();

  alertRules.forEach((rule) => {
    merged.set(`${rule.protocol}:${rule.target}:${rule.port ?? 0}`, rule);
  });

  recentTargets.forEach((target, index) => {
    const key = `${target.protocol}:${target.target}:${target.port ?? 0}`;
    if (merged.has(key)) {
      return;
    }

    merged.set(key, {
      id: -(index + 1),
      name: "",
      protocol: target.protocol,
      target: target.target,
      port: target.port ?? null,
      recipient_email: "",
      consecutive_breaches: 1,
      cooldown_minutes: 30,
      notify_on_recovery: false,
      enabled: true,
      last_state: "healthy",
      current_breach_streak: 0,
      created_at: new Date(target.last_sample_at).toISOString(),
    });
  });

  return Array.from(merged.values()).slice(0, 12);
}

function mergeTrackedRulesFromLiveSamples(rules: AlertRule[], liveSamples: LiveTelemetrySample[]) {
  const merged = new Map<string, AlertRule>();

  rules.forEach((rule) => {
    merged.set(`${rule.protocol}:${rule.target}:${rule.port ?? 0}`, rule);
  });

  liveSamples.forEach((sample, index) => {
    const key = `${sample.protocol}:${sample.target}:${sample.port ?? 0}`;
    if (merged.has(key)) {
      return;
    }

    merged.set(key, {
      id: -(1000 + index + 1),
      name: "",
      protocol: sample.protocol,
      target: sample.target,
      port: sample.port ?? null,
      recipient_email: "",
      consecutive_breaches: 1,
      cooldown_minutes: 30,
      notify_on_recovery: false,
      enabled: true,
      last_state: sample.error ? "alert" : "healthy",
      current_breach_streak: 0,
      created_at: new Date(sample.ts).toISOString(),
    });
  });

  return Array.from(merged.values()).slice(0, 12);
}

export function OverviewWorkspace() {
  const queryClient = useQueryClient();
  const fetchingCount = useIsFetching();
  const [liveSamples, setLiveSamples] = useState<LiveTelemetrySample[]>([]);
  useEffect(() => {
    return subscribeLiveTelemetry((sample) => {
      setLiveSamples((current) => [...current, sample].slice(-96));
    });
  }, []);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
    staleTime: 60_000,
  });
  const isDemo = sessionQuery.data?.read_only === true;
  const demoData = useMemo(() => buildOverviewDemoData(), []);

  // Live events refetch these as monitors check in; polling is the fallback.
  const historyInterval = useLiveInterval(5_000);
  const alertsInterval = useLiveInterval(20_000);

  const runtimeHealthQuery = useQuery({
    queryKey: ["runtime-health"],
    queryFn: () => apiRequest<RuntimeHealthResponse>("/api/healthz"),
    refetchInterval: 30_000,
  });

  const alertRulesQuery = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiRequest<AlertRule[]>("/api/alerts/rules"),
    refetchInterval: alertsInterval,
    enabled: sessionQuery.data?.authenticated === true && !isDemo,
  });

  const recentTargetsQuery = useQuery({
    queryKey: ["recent-history-targets"],
    queryFn: () => apiRequest<RecentHistoryTarget[]>("/api/history/recent-targets?limit=12"),
    refetchInterval: historyInterval,
    enabled: sessionQuery.data?.authenticated === true && !isDemo,
  });

  const alertRulesSource = useMemo(
    () => (isDemo ? demoData.alertRules : alertRulesQuery.data ?? []),
    [alertRulesQuery.data, demoData.alertRules, isDemo],
  );
  const recentTargetsSource = useMemo(
    () => (isDemo ? demoData.recentTargets : recentTargetsQuery.data ?? []),
    [demoData.recentTargets, isDemo, recentTargetsQuery.data],
  );

  const trackedRules = useMemo(
    () => mergeTrackedRules(uniqueAlertTargets(alertRulesSource), recentTargetsSource),
    [alertRulesSource, recentTargetsSource],
  );
  const trackedRulesWithLive = useMemo(() => mergeTrackedRulesFromLiveSamples(trackedRules, liveSamples), [trackedRules, liveSamples]);

  const historyQueries = useQueries({
    queries: isDemo ? [] : trackedRulesWithLive.map((rule) => {
      const params = new URLSearchParams({
        type: rule.protocol,
        host: rule.target,
        limit: "24",
      });
      if (rule.protocol === "tcpping" && rule.port) {
        params.set("port", String(rule.port));
      }
      return {
        queryKey: ["overview-history", rule.protocol, rule.target, rule.port ?? 0],
        queryFn: () => apiRequest<HistoryPoint[]>(`/api/history?${params.toString()}`),
        refetchInterval: historyInterval,
      };
    }),
  });

  const historyMap = useMemo(() => {
    if (isDemo) {
      return demoData.historyMap;
    }
    const map = new Map<string, HistoryPoint[]>();
    trackedRulesWithLive.forEach((rule, index) => {
      const key = `${rule.protocol}:${rule.target}:${rule.port ?? 0}`;
      map.set(key, historyQueries[index]?.data ?? []);
    });
    return map;
  }, [demoData.historyMap, historyQueries, isDemo, trackedRulesWithLive]);

  const liveSampleMap = useMemo(() => {
    const map = new Map<string, LiveTelemetrySample>();
    liveSamples.forEach((sample) => {
      map.set(`${sample.protocol}:${sample.target}:${sample.port ?? 0}`, sample);
    });
    return map;
  }, [liveSamples]);

  // Samples streamed from a tool tab in this browser land on the chart before the next history poll.
  const chartHistoryMap = useMemo(() => {
    if (!liveSamples.length) return historyMap;
    const map = new Map(historyMap);
    liveSamples.forEach((sample) => {
      const key = `${sample.protocol}:${sample.target}:${sample.port ?? 0}`;
      const points = map.get(key);
      if (!points) return;
      const lastTs = points.reduce((max, p) => Math.max(max, p.ts), 0);
      if (sample.ts <= lastTs) return;
      map.set(key, [...points, { ts: sample.ts, rtt_ms: sample.rttMs ?? undefined, error: sample.error }].slice(-48));
    });
    return map;
  }, [historyMap, liveSamples]);

  const targetSnapshots = useMemo(
    () =>
      buildOverviewTargetSnapshots(trackedRulesWithLive, historyMap, recentTargetsSource).map((snapshot) => {
        const liveSample = liveSampleMap.get(snapshot.id);
        if (!liveSample) {
          return snapshot;
        }
        return {
          ...snapshot,
          healthState:
            liveSample.error && snapshot.healthState !== "critical"
              ? "warning"
              : snapshot.healthState === "idle" && !liveSample.error
                ? "stable"
                : snapshot.healthState,
          lastSampleAt: Math.max(snapshot.lastSampleAt ?? 0, liveSample.ts),
          lastRttMs: liveSample.rttMs ?? snapshot.lastRttMs,
        };
      }),
    [trackedRulesWithLive, historyMap, recentTargetsSource, liveSampleMap],
  );
  const alertRuleCount = alertRulesSource.length;
  const firingCount = alertRulesSource.filter((rule) => rule.enabled && rule.last_state === "alert").length;
  const hasData = targetSnapshots.length > 0;
  // Until the first answers arrive the page would read as an empty workspace
  // ("0 targets", "No probe results yet"); show its shape instead.
  const firstLoad = !isDemo && (sessionQuery.isPending || alertRulesQuery.isPending || recentTargetsQuery.isPending);
  if (firstLoad) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <WelcomeHeader
        name={sessionQuery.data?.user?.name}
        targets={targetSnapshots}
        health={runtimeHealthQuery.data}
        onRefresh={() => queryClient.invalidateQueries()}
        refreshing={fetchingCount > 0}
      />
      <StatCards targets={targetSnapshots} historyMap={historyMap} alertRuleCount={alertRuleCount} firingCount={firingCount} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <MonitorResponseChart enabled={sessionQuery.data?.authenticated === true && !isDemo} fallback={<ResponseTimeChart targets={targetSnapshots} historyMap={chartHistoryMap} />} />
        <TargetHealthCard targets={targetSnapshots} />
      </div>
      <TargetsSummary targets={targetSnapshots} historyMap={chartHistoryMap} />
      {hasData ? null : <GettingStarted hasAlertRules={alertRuleCount > 0} />}
      <ComingNext />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5" role="status" aria-label="Loading the overview">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[142px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Skeleton className="h-[296px] rounded-xl" />
        <Skeleton className="h-[296px] rounded-xl" />
      </div>
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  );
}
