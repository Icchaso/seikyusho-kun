/**
 * 金額計算。適格請求書(インボイス制度)の要件に沿って、
 * 「税率ごとに区分した合計額」と「税率ごとの消費税額」を出す。
 *
 * 重要: 消費税の端数処理は **税率ごとに1回だけ** 行う。
 * 明細1行ごとに端数処理すると合計がズレて、適格請求書として不適切になる。
 */
import type {
  ComputedItem,
  LineItem,
  Rounding,
  TaxBucket,
  TaxConfig,
  TaxRate,
  Totals,
} from "./types.js";

/** 源泉徴収の税率(復興特別所得税込み) */
const WITHHOLDING_RATE_LOW = 0.1021;
const WITHHOLDING_RATE_HIGH = 0.2042;
/** 100万円までは10.21%、超えた部分は20.42% */
const WITHHOLDING_THRESHOLD = 1_000_000;
const WITHHOLDING_AT_THRESHOLD = 102_100;

export function applyRounding(value: number, mode: Rounding): number {
  switch (mode) {
    case "ceil":
      return Math.ceil(value);
    case "round":
      return Math.round(value);
    case "floor":
    default:
      return Math.floor(value);
  }
}

/**
 * 明細の入力を、数量・単価・金額がすべて埋まった形に正規化する。
 * - qty 省略 → 1
 * - unitPrice 省略 → amount / qty
 * - amount 省略 → qty * unitPrice
 */
export function normalizeItems(
  items: LineItem[],
  tax: TaxConfig,
): ComputedItem[] {
  return items.map((raw) => {
    const qty = raw.qty ?? 1;

    if (raw.amount === undefined && raw.unitPrice === undefined) {
      throw new Error(`明細「${raw.name}」に金額も単価もありません`);
    }
    const amount = raw.amount ?? qty * (raw.unitPrice as number);
    const unitPrice = raw.unitPrice ?? (qty === 0 ? 0 : amount / qty);

    const taxRate: TaxRate = raw.taxRate ?? tax.defaultRate;
    const inclusive = tax.mode === "inclusive";

    // 表示用の税抜/税込。合計は必ず buckets 側から出すので、ここは行単位の目安。
    const amountIncl = inclusive
      ? amount
      : amount + applyRounding((amount * taxRate) / 100, tax.rounding);
    const amountExcl = inclusive
      ? amount - applyRounding((amount * taxRate) / (100 + taxRate), tax.rounding)
      : amount;

    const item: ComputedItem = {
      name: raw.name,
      qty,
      unit: raw.unit ?? "",
      unitPrice: Math.round(unitPrice),
      amountExcl,
      amountIncl,
      taxRate,
      reduced: taxRate === 8,
    };
    if (raw.note) item.note = raw.note;
    return item;
  });
}

/** 税率ごとに区分し、税率ごとに1回だけ端数処理して消費税額を出す */
export function buildBuckets(
  items: ComputedItem[],
  tax: TaxConfig,
): TaxBucket[] {
  const inclusive = tax.mode === "inclusive";
  const sums = new Map<TaxRate, number>();

  for (const item of items) {
    const raw = inclusive ? item.amountIncl : item.amountExcl;
    sums.set(item.taxRate, (sums.get(item.taxRate) ?? 0) + raw);
  }

  const rates = [...sums.keys()].sort((a, b) => b - a);
  return rates.map((rate) => {
    const sum = sums.get(rate) ?? 0;
    if (rate === 0) {
      return { rate, taxable: sum, tax: 0, total: sum };
    }
    if (inclusive) {
      const taxAmount = applyRounding((sum * rate) / (100 + rate), tax.rounding);
      return { rate, taxable: sum - taxAmount, tax: taxAmount, total: sum };
    }
    const taxAmount = applyRounding((sum * rate) / 100, tax.rounding);
    return { rate, taxable: sum, tax: taxAmount, total: sum + taxAmount };
  });
}

/**
 * 源泉徴収税額。
 * 消費税額を請求書上で明確に区分している場合は税抜金額を対象にできる(国税庁の取扱い)。
 * 1回の支払額が100万円以下の部分は10.21%、超える部分は20.42%。端数は切り捨て。
 */
export function calcWithholding(taxableExcl: number): number {
  if (taxableExcl <= WITHHOLDING_THRESHOLD) {
    return Math.floor(taxableExcl * WITHHOLDING_RATE_LOW);
  }
  return (
    WITHHOLDING_AT_THRESHOLD +
    Math.floor((taxableExcl - WITHHOLDING_THRESHOLD) * WITHHOLDING_RATE_HIGH)
  );
}

/** 明細から合計一式を組み立てる */
export function calcTotals(items: ComputedItem[], tax: TaxConfig): Totals {
  const buckets = buildBuckets(items, tax);
  const subtotal = buckets.reduce((a, b) => a + b.taxable, 0);
  const taxTotal = buckets.reduce((a, b) => a + b.tax, 0);
  const total = subtotal + taxTotal;

  const totals: Totals = {
    buckets,
    subtotal,
    taxTotal,
    total,
    hasReduced: buckets.some((b) => b.rate === 8),
  };

  if (tax.withholding) {
    const wh = calcWithholding(subtotal);
    totals.withholding = wh;
    totals.payable = total - wh;
  }
  return totals;
}

/** 3桁区切り。¥ は付けない */
export function yen(n: number): string {
  return n.toLocaleString("ja-JP");
}
