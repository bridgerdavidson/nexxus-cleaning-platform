"use client";
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { replaceSearchShallow } from "@/lib/shallowSearch";
import { useOrgQuery } from "@/lib/useOrgQuery";
import { useAuth } from "@/hooks/useAuth";
import { keys } from "@/lib/queryKeys";
import { resolveRange } from "@/components/redesign/analytics/deriveAnalytics";
import type {
  AnalyticsSummary,
  CancellationsData,
  DemandCell,
  LeaderRow,
  RangePreset,
  ResolvedRange,
  ServiceMixRow,
  TimeseriesPoint,
} from "@/components/redesign/analytics/analytics-types";

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "12m"];

export function useAnalyticsRange(): {
  range: ResolvedRange;
  setPreset: (p: RangePreset) => void;
} {
  const params = useSearchParams();
  const raw = params.get("range");
  const preset: RangePreset = (PRESETS as string[]).includes(raw ?? "")
    ? (raw as RangePreset)
    : "30d";
  const range = resolveRange(preset, new Date());
  const setPreset = useCallback(
    (p: RangePreset) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("range", p);
      replaceSearchShallow(`?${sp.toString()}`);
    },
    [params],
  );
  return { range, setPreset };
}

export function useAnalyticsSummary(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.summary(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_summary", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw error;
      return (data ?? null) as AnalyticsSummary | null;
    },
  });
  return { summary: q.data ?? null, loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}

export function useAnalyticsRevenueSeries(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.timeseries(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_revenue_timeseries", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
        p_grain: range.grain,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): TimeseriesPoint => ({
          bucketStart: String(r.bucket_start),
          collectedCents: r.collected_cents == null ? null : Number(r.collected_cents),
          bookedCents: r.booked_cents == null ? null : Number(r.booked_cents),
          jobs: Number(r.jobs ?? 0),
        }),
      );
    },
  });
  return { series: q.data ?? [], loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}

export function useAnalyticsServiceMix(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.serviceMix(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_service_mix", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): ServiceMixRow => ({
          serviceTypeId: String(r.service_type_id),
          name: String(r.name),
          revenueCents: r.revenue_cents == null ? null : Number(r.revenue_cents),
          jobs: Number(r.jobs ?? 0),
          avgTicketCents: r.avg_ticket_cents == null ? null : Number(r.avg_ticket_cents),
        }),
      );
    },
  });
  return { rows: q.data ?? [], loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}

export function useAnalyticsLeaderboard(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.leaderboard(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_cleaner_leaderboard", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): LeaderRow => ({
          cleanerId: String(r.cleaner_id),
          name: String(r.name).trim() || "Cleaner",
          jobs: Number(r.jobs ?? 0),
          revenueCents: r.revenue_cents == null ? null : Number(r.revenue_cents),
          avgRating: r.avg_rating == null ? null : Number(r.avg_rating),
        }),
      );
    },
  });
  return { rows: q.data ?? [], loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}

export function useAnalyticsDemand(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.demand(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_demand_heatmap", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): DemandCell => ({
          dow: Number(r.dow),
          hour: Number(r.hour),
          jobs: Number(r.jobs ?? 0),
        }),
      );
    },
  });
  return { cells: q.data ?? [], loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}

export function useAnalyticsCancellations(range: ResolvedRange) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const q = useOrgQuery({
    queryKey: keys.analytics.cancellations(orgId, range.rangeKey),
    queryFn: async ({ orgId: id }) => {
      const { data, error } = await supabase.rpc("analytics_cancellations", {
        p_org_id: id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw error;
      return (data ?? null) as CancellationsData | null;
    },
  });
  return { data: q.data ?? null, loading: q.isLoading, error: q.error?.message ?? null, refetch: q.refetch };
}
