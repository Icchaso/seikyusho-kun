/** 請求書番号の採番。連番は ~/.seikyusho-kun/counter.json に持つ */
import fs from "node:fs";
import { counterPath, ensureDir, homeDir } from "./paths.js";

type Counter = Record<string, number>;

function readCounter(): Counter {
  const p = counterPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Counter;
  } catch {
    return {};
  }
}

function writeCounter(c: Counter): void {
  ensureDir(homeDir());
  fs.writeFileSync(counterPath(), JSON.stringify(c, null, 2) + "\n", "utf-8");
}

/**
 * 連番のリセット単位をパターンから決める。
 * {mm} を含む → 月ごと / {yyyy} だけ → 年ごと / どちらも無い → 通し番号
 */
export function counterScope(pattern: string, date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  if (pattern.includes("{mm}")) return `${yyyy}-${mm}`;
  if (pattern.includes("{yyyy}") || pattern.includes("{yy}")) return yyyy;
  return "all";
}

/** パターンを実際の番号に展開する(採番はしない) */
export function formatInvoiceNo(
  pattern: string,
  date: Date,
  seq: number,
): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return pattern
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{yy\}/g, yyyy.slice(2))
    .replace(/\{mm\}/g, mm)
    .replace(/\{dd\}/g, dd)
    .replace(/\{seq:(\d+)\}/g, (_m, w: string) =>
      String(seq).padStart(Number(w), "0"),
    )
    .replace(/\{seq\}/g, String(seq));
}

/** 次の番号を予約して返す(カウンタを1つ進める) */
export function nextInvoiceNo(pattern: string, date: Date): string {
  const counter = readCounter();
  const scope = counterScope(pattern, date);
  const seq = (counter[scope] ?? 0) + 1;
  counter[scope] = seq;
  writeCounter(counter);
  return formatInvoiceNo(pattern, date, seq);
}

/** 採番せずに「次はこれ」を覗く */
export function peekInvoiceNo(pattern: string, date: Date): string {
  const counter = readCounter();
  const scope = counterScope(pattern, date);
  return formatInvoiceNo(pattern, date, (counter[scope] ?? 0) + 1);
}

/** 連番を巻き戻す(発行に失敗したときに番号を飛ばさないため) */
export function rollbackInvoiceNo(pattern: string, date: Date): void {
  const counter = readCounter();
  const scope = counterScope(pattern, date);
  if (counter[scope] && counter[scope] > 0) {
    counter[scope] -= 1;
    writeCounter(counter);
  }
}
