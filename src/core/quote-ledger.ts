/**
 * 見積台帳。発行した見積書を1件ずつ記録する。
 *
 * 請求書の台帳(issued.json)と分けているのは、
 *  - list / send が請求書だけを見ている前提を壊さないため
 *  - 受注したときに「見積の明細をそのまま請求書へ」渡せるよう、明細まで持つため
 */
import fs from "node:fs";
import path from "node:path";
import type { Client, InvoiceDoc, LineItem } from "./types.js";
import { ensureDir, homeDir } from "./paths.js";

export interface QuoteEntry {
  quoteNo: string;
  /** 宛先。請求書へ変換するときにそのまま使う */
  client: Client;
  issueDate: string;
  /** 有効期限 (ISO) */
  validUntil: string;
  /** 明細。計算前の入力の形で持つ(請求書へ渡すため) */
  items: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  pdfPath: string;
  theme: string;
  notes?: string[];
  delivery?: string;
  deliveryFormat?: string;
  revisions?: string;
  /** 請求書に変換したらその請求書番号 */
  invoicedNo?: string;
  invoicedAt?: string;
}

const quotesPath = () => path.join(homeDir(), "quotes.json");

export function readQuotes(): QuoteEntry[] {
  const p = quotesPath();
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as QuoteEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeQuotes(entries: QuoteEntry[]): void {
  ensureDir(homeDir());
  fs.writeFileSync(quotesPath(), JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

export function recordQuote(
  doc: InvoiceDoc,
  client: Client,
  items: LineItem[],
  pdfPath: string,
  theme: string,
): QuoteEntry {
  const entry: QuoteEntry = {
    quoteNo: doc.invoiceNo,
    client,
    issueDate: doc.issueDateISO,
    validUntil: doc.terms?.validUntilISO ?? doc.dueDateISO,
    items,
    subtotal: doc.totals.subtotal,
    tax: doc.totals.taxTotal,
    total: doc.totals.total,
    pdfPath,
    theme,
    ...(doc.notes && doc.notes.length ? { notes: doc.notes } : {}),
    ...(doc.terms?.delivery ? { delivery: doc.terms.delivery } : {}),
    ...(doc.terms?.deliveryFormat
      ? { deliveryFormat: doc.terms.deliveryFormat }
      : {}),
    ...(doc.terms?.revisions ? { revisions: doc.terms.revisions } : {}),
  };
  // 同じ番号で出し直したときは上書きする
  const entries = readQuotes().filter((e) => e.quoteNo !== entry.quoteNo);
  entries.push(entry);
  entries.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  writeQuotes(entries);
  return entry;
}

/**
 * 見積書を探す。見積書番号の完全一致が最優先。
 * 見つからなければ取引先名で探して、その中のいちばん新しいものを返す。
 */
export function findQuote(query: string): QuoteEntry | null {
  const q = query.trim();
  if (!q) return null;
  const entries = readQuotes();

  const byNo = entries.find(
    (e) => e.quoteNo.toLowerCase() === q.toLowerCase(),
  );
  if (byNo) return byNo;

  const byClient = entries.filter((e) => e.client.name.includes(q));
  byClient.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  return byClient[0] ?? null;
}

/** 請求書に変換したことを記録する */
export function markInvoiced(quoteNo: string, invoiceNo: string): void {
  const entries = readQuotes();
  const entry = entries.find((e) => e.quoteNo === quoteNo);
  if (!entry) return;
  entry.invoicedNo = invoiceNo;
  entry.invoicedAt = new Date().toISOString();
  writeQuotes(entries);
}
