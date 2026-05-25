// tenant-template/scripts/lib.mjs
// 純驗證/計算演算法。同時被 GitHub Actions runner 與 worker 單元測試使用。
// 無外部相依，僅用 Node 內建能力。

// 各活動類型的合法單位。需與排放係數 (emission-factors.json) 的分母單位、
// 以及 Web Form (submit.ts) 的單位選項保持一致，否則計算階段會無法換算。
// water 以公噸 (ton) 計：水密度 1，1 m³ ≈ 1 公噸，故係數值不變。
export const UNIT_RULES = {
  electricity: ['kWh'],
  natural_gas: ['Nm3'],
  diesel:      ['L'],
  water:       ['ton'],
  waste:       ['ton', 'kg'],
  product:     ['pcs', 'kg', 'ton'],
  transport:   ['km'],
};

export function validateUnit(activityType, unit) {
  const allowed = UNIT_RULES[activityType];
  if (!allowed) return { ok: false, message: `未知活動類型：${activityType}` };
  if (!allowed.includes(unit)) {
    return { ok: false, message: `活動類型 ${activityType} 不允許單位 ${unit}（合法單位：${allowed.join(', ')}）` };
  }
  return { ok: true };
}

const MASS_TO_KG = { kg: 1, ton: 1000 };

export function convertUnit(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  if (fromUnit in MASS_TO_KG && toUnit in MASS_TO_KG) {
    return (amount * MASS_TO_KG[fromUnit]) / MASS_TO_KG[toUnit];
  }
  return null;
}

export function matchFactor(factors, activityType, region, year) {
  const candidates = factors.filter((f) => f.activity_type === activityType);
  if (candidates.length === 0) return null;
  const exact = candidates.find((f) => f.region === region && f.year === year);
  if (exact) return exact;
  const sameRegion = candidates.filter((f) => f.region === region).sort((a, b) => b.year - a.year);
  if (sameRegion.length) return sameRegion[0];
  return candidates.slice().sort((a, b) => b.year - a.year)[0];
}

export function calculateCo2e(amount, unit, factor) {
  const denom = factor.unit.split('/')[1];
  let qty = amount;
  if (denom !== unit) {
    const converted = convertUnit(amount, unit, denom);
    if (converted === null) return null;
    qty = converted;
  }
  return qty * factor.value;
}

export function detectOutlier(current, history) {
  if (!history || history.length === 0) return { outlier: false };
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  if (avg > 0 && current > avg * 10) {
    return { outlier: true, message: `數值 ${current} 超過歷史平均 ${avg.toFixed(1)} 的 10 倍，請確認` };
  }
  return { outlier: false };
}
