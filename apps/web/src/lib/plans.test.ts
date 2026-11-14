import { describe, expect, it } from "vitest";
import { comparisonRows, planCopy, proPricing, taka } from "@/lib/plans";
import type { PlanLimits, PublicPlansResponse } from "@/lib/types";

const month = { plan: "pro", months: 1, amount: 1500 };
const year = { plan: "pro", months: 12, amount: 15000 };

describe("proPricing", () => {
  it("spreads the yearly price over twelve months and finds the saving", () => {
    const p = proPricing([month, year]);
    expect(p.monthly).toEqual({ perMonth: 1500, total: 1500, months: 1 });
    expect(p.yearly).toEqual({ perMonth: 1250, total: 15000, months: 12 });
    expect(p.saving).toBe(3000); // 12 × 1,500 − 15,000
    expect(p.savingPercent).toBe(16); // 3,000 / 18,000 = 16.7%, rounded down
    expect(p.freeMonths).toBe(2);
  });

  it("never rounds the monthly share in its own favour", () => {
    // 10,000 / 12 = 833.333…: shown as 833.33, not 833.34.
    expect(proPricing([{ plan: "pro", months: 12, amount: 10000 }]).yearly?.perMonth).toBe(833.33);
  });

  it("gives no free months when the saving isn't a whole number of them", () => {
    const p = proPricing([month, { plan: "pro", months: 12, amount: 16000 }]);
    expect(p.saving).toBe(2000);
    expect(p.freeMonths).toBe(0);
    expect(p.savingPercent).toBe(11);
  });

  it("claims no saving when a year costs more than twelve months", () => {
    const p = proPricing([month, { plan: "pro", months: 12, amount: 20000 }]);
    expect(p.saving).toBe(0);
    expect(p.savingPercent).toBe(0);
  });

  it("works with only one period on sale", () => {
    const p = proPricing([month]);
    expect(p.yearly).toBeUndefined();
    expect(p.saving).toBe(0);
  });
});

describe("taka", () => {
  it("writes amounts the way the site shows them", () => {
    expect(taka(15000)).toBe("BDT 15,000");
    expect(taka(833.33)).toBe("BDT 833.33");
    expect(taka(0)).toBe("BDT 0");
  });
});

const limits = (n: number): PlanLimits => ({
  monitors: 20 * n,
  api_keys: 10 * n,
  members: 25 * n,
  probes_per_hour: 600 * n,
  scans_per_hour: 30 * n,
  api_requests_per_minute: 120 * n,
  status_pages: n,
  agents: 2 * n,
  monitor_locations: 2,
  watched_domains: 3 * n,
  verified_domains: 5 * n,
  surface_scans_per_hour: 2 * n,
  deep_scans_per_month: n === 1 ? 0 : 10 * n,
  host_alert_rules: 5 * n,
  devices: 5 * n,
});

describe("plan copy", () => {
  it("is written from the limits the server sends", () => {
    const copy = planCopy("free", limits(1));
    expect(copy.headline).toContainEqual(["Monitors", "20"]);
    expect(copy.features.map((f) => f.label)).toContain("1 public status page");
  });

  it("marks a limit of zero as not included in the comparison", () => {
    const catalog: PublicPlansResponse = {
      currency: "BDT",
      payments_enabled: true,
      history_days: 7,
      plans: [
        { id: "free", name: "Free", limits: limits(1), prices: [] },
        { id: "pro", name: "Pro", limits: limits(10), prices: [month, year] },
      ],
    };
    const deep = comparisonRows(catalog)
      .flatMap((g) => g.rows)
      .find((r) => r.label === "Deep security scans");
    expect(deep?.values).toEqual([false, "100 / month"]);
  });
});
