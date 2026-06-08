/**
 * Depreciation Engine — SLM and WDV calculations with day-proration
 */

function toUtcDate(val) {
  if (!val) return null;
  const s = val instanceof Date ? val.toISOString().split('T')[0] : String(val).split('T')[0];
  return new Date(s + 'T00:00:00Z');
}

/**
 * Calculate depreciation for a single asset over [periodFrom, periodTo].
 * @returns { skip, reason?, opening_wdv, depreciation_amount, closing_wdv, days_in_period }
 */
function calculateForAsset(asset, category, periodFrom, periodTo) {
  const MS_PER_DAY = 86400000;
  const pfDate  = toUtcDate(periodFrom);
  const ptDate  = toUtcDate(periodTo);

  if (asset.status !== 'active') return { skip: true, reason: 'Asset not active' };

  const inServiceDate = toUtcDate(asset.in_service_date);
  if (inServiceDate > ptDate) return { skip: true, reason: 'Not yet in service during this period' };

  // Effective window inside the period
  const effectiveStart = inServiceDate > pfDate ? inServiceDate : pfDate;
  let   effectiveEnd   = ptDate;

  if (asset.disposal_date) {
    const disposalDate = toUtcDate(asset.disposal_date);
    if (disposalDate < effectiveStart) return { skip: true, reason: 'Disposed before period start' };
    if (disposalDate < ptDate)         effectiveEnd = disposalDate;
  }

  const daysInPeriod = Math.round((effectiveEnd - effectiveStart) / MS_PER_DAY) + 1;
  if (daysInPeriod <= 0) return { skip: true, reason: 'Zero days in period' };

  const cost        = parseFloat(asset.purchase_cost);
  const salvage     = parseFloat(asset.salvage_value) || 0;
  const accumulated = parseFloat(asset.accumulated_depreciation) || 0;
  const rate        = parseFloat(category.depreciation_rate_pct) / 100;
  const method      = category.depreciation_method;

  const openingWdv    = cost - accumulated;
  const maxDepreciable = cost - salvage - accumulated;

  if (maxDepreciable <= 0.005) return { skip: true, reason: 'Asset fully depreciated' };

  const annualDepr = method === 'SLM'
    ? (cost - salvage) * rate
    : openingWdv * rate;

  let periodDepr = Math.round((annualDepr / 365) * daysInPeriod * 100) / 100;
  if (periodDepr > maxDepreciable) periodDepr = Math.round(maxDepreciable * 100) / 100;

  return {
    skip:               false,
    opening_wdv:        Math.round(openingWdv * 100) / 100,
    depreciation_amount: periodDepr,
    closing_wdv:        Math.round((openingWdv - periodDepr) * 100) / 100,
    days_in_period:     daysInPeriod,
  };
}

/**
 * Project monthly depreciation for the next N months starting from current month.
 */
function projectSchedule(asset, category, months = 12) {
  const schedule   = [];
  let accumulated  = parseFloat(asset.accumulated_depreciation) || 0;
  const cost       = parseFloat(asset.purchase_cost);

  const today = new Date();
  let cur = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  for (let i = 0; i < months; i++) {
    const next       = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const periodFrom = cur.toISOString().split('T')[0];
    const periodTo   = new Date(next.getTime() - 86400000).toISOString().split('T')[0];

    const tempAsset = { ...asset, accumulated_depreciation: accumulated };
    const result    = calculateForAsset(tempAsset, category, periodFrom, periodTo);

    if (result.skip) {
      if (result.reason === 'Asset fully depreciated') break;
      schedule.push({ period_from: periodFrom, period_to: periodTo, depreciation_amount: 0,
                      wdv_after: cost - accumulated, skipped: true, reason: result.reason });
    } else {
      accumulated = Math.round((accumulated + result.depreciation_amount) * 100) / 100;
      schedule.push({
        period_from:         periodFrom,
        period_to:           periodTo,
        opening_wdv:         result.opening_wdv,
        depreciation_amount: result.depreciation_amount,
        closing_wdv:         result.closing_wdv,
        days_in_period:      result.days_in_period,
        accumulated_after:   accumulated,
      });
    }

    cur = next;
  }

  return schedule;
}

module.exports = { calculateForAsset, projectSchedule };
