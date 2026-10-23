// Picks the daily rate for a rental from pricing_rules (pure; the caller loads the rules).

export type RateRule = {
  id: string;
  categoryId: string | null;
  vehicleId: string | null;
  branchId: string | null;
  dailyRateFils: number;
  minDays: number;
  maxDays: number | null;
  /** YYYY-MM-DD, branch-local pick-up date, inclusive. */
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  isActive: boolean;
};

export type RateTarget = {
  vehicleId: string;
  categoryId: string;
  /** Pick-up branch. */
  branchId: string;
  /** Pick-up date in the branch time zone, YYYY-MM-DD. */
  pickupLocalDate: string;
  rentalDays: number;
};

export function ruleMatches(rule: RateRule, t: RateTarget): boolean {
  if (!rule.isActive) return false;
  if (rule.vehicleId) {
    if (rule.vehicleId !== t.vehicleId) return false;
  } else if (rule.categoryId !== t.categoryId) {
    return false;
  }
  if (rule.branchId && rule.branchId !== t.branchId) return false;
  if (t.rentalDays < rule.minDays) return false;
  if (rule.maxDays !== null && t.rentalDays > rule.maxDays) return false;
  if (rule.validFrom && t.pickupLocalDate < rule.validFrom) return false;
  if (rule.validTo && t.pickupLocalDate > rule.validTo) return false;
  return true;
}

/**
 * Most specific matching rule wins: vehicle rule > category rule, then branch-specific > any
 * branch, then a dated (seasonal) rule > open-ended, then higher priority, then the larger
 * minDays (long-rental discounts), then the lower rate, then id. Null if nothing matches.
 */
export function selectRateRule<R extends RateRule>(rules: readonly R[], target: RateTarget): R | null {
  const matching = rules.filter((r) => ruleMatches(r, target));
  if (!matching.length) return null;
  const key = (r: RateRule) => [
    r.vehicleId ? 1 : 0,
    r.branchId ? 1 : 0,
    r.validFrom || r.validTo ? 1 : 0,
    r.priority,
    r.minDays,
    -r.dailyRateFils,
  ];
  return matching.reduce((best, r) => {
    const a = key(r);
    const b = key(best);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? r : best;
    }
    return r.id < best.id ? r : best;
  });
}
