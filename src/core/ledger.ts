/**
 * 発行台帳。発行した請求書を1行ずつ記録する。
 * あとから「あの請求書をメールで送る」「もう送ったか」を引けるようにするため。
 */
import fs from "node:fs";
import path from "node:path";
import type { InvoiceDoc } from "./types.js";
import { ensureDir, homeDir } from "./paths.js";

export interface LedgerEntry {
  invoiceNo: string;
  client: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  payable: number;
  pdfPath: string;
  theme: string;
  /** メールを送った日時(ISO)。未送信なら undefined */
  emailedAt?: string;
  emailedTo?: string;
}

const ledgerPath = () => path.join(homeDir(), "issued.json");

export function readLedger(): LedgerEntry[] {
  const p = ledgerPath();
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as LedgerEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLedger(entries: LedgerEntry[]): void {
  ensureDir(homeDir());
  fs.writeFileSync(ledgerPath(), JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

export function recordIssue(
  doc: InvoiceDoc,
  pdfPath: string,
  theme: string,
): LedgerEntry {
  const entry: LedgerEntry = {
    invoiceNo: doc.invoiceNo,
    client: doc.client.name,
    issueDate: doc.issueDateISO,
    dueDate: doc.dueDateISO,
    subtotal: doc.totals.subtotal,
    tax: doc.totals.taxTotal,
    total: doc.totals.total,
    payable: doc.totals.payable ?? doc.totals.total,
    pdfPath,
    theme,
  };
  const entries = readLedger().filter((e) => e.invoiceNo !== entry.invoiceNo);
  entries.push(entry);
  entries.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  writeLedger(entries);
  return entry;
}

/** 取引先の最新の発行分を返す(請求書番号を指定すればそれを返す) */
export function findEntry(
  clientName: string,
  invoiceNo?: string,
): LedgerEntry | null {
  const entries = readLedger();
  if (invoiceNo) return entries.find((e) => e.invoiceNo === invoiceNo) ?? null;
  const mine = entries.filter((e) => e.client === clientName);
  mine.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  return mine[0] ?? null;
}

export function markEmailed(invoiceNo: string, to: string): void {
  const entries = readLedger();
  const entry = entries.find((e) => e.invoiceNo === invoiceNo);
  if (!entry) return;
  entry.emailedAt = new Date().toISOString();
  entry.emailedTo = to;
  writeLedger(entries);
}
