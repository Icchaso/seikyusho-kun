/** 入力 → 請求書ドキュメント → PDF の組み立て */
import fs from "node:fs";
import path from "node:path";
import type {
  Client,
  Config,
  InvoiceDoc,
  LineItem,
} from "./types.js";
import { calcTotals, normalizeItems } from "./money.js";
import { formatISO, formatJP } from "./dates.js";
import { guessHonorific } from "./honorific.js";
import { logoToDataUri } from "./render.js";
import { resolveOutputDir } from "./config.js";
import { ensureDir, safeFileName } from "./paths.js";
import { buildPdf, type FitResult } from "./autofit.js";
import { runAfterIssue, type HookResult } from "./hooks.js";
import { recordIssue, type LedgerEntry } from "./ledger.js";

export interface BuildDocParams {
  config: Config;
  client: Client;
  items: LineItem[];
  invoiceNo: string;
  issueDate: Date;
  dueDate: Date;
  notes?: string[];
  greeting?: string;
}

export function buildInvoiceDoc(p: BuildDocParams): InvoiceDoc {
  const { config } = p;
  const items = normalizeItems(p.items, config.tax);
  const totals = calcTotals(items, config.tax);

  const doc: InvoiceDoc = {
    invoiceNo: p.invoiceNo,
    issueDate: formatJP(p.issueDate),
    dueDate: formatJP(p.dueDate),
    issueDateISO: formatISO(p.issueDate),
    dueDateISO: formatISO(p.dueDate),
    client: {
      name: p.client.name,
      honorific: p.client.honorific || guessHonorific(p.client.name),
      ...(p.client.contact ? { contact: p.client.contact } : {}),
      ...(p.client.zip ? { zip: p.client.zip } : {}),
      ...(p.client.address ? { address: p.client.address } : {}),
      ...(p.client.tel ? { tel: p.client.tel } : {}),
    },
    issuer: config.issuer,
    bank: config.bank,
    items,
    emptyRows: Math.max(0, config.minRows - items.length),
    totals,
    taxMode: config.tax.mode,
    greeting: p.greeting ?? config.greeting,
    notes: p.notes ?? config.notes,
    accentColor: config.accentColor,
    density: "d1",
    pageLabel: "",
    showUnit: items.some((i) => Boolean(i.unit)),
  };

  const logo = logoToDataUri(config.issuer.logo);
  if (logo) doc.logoDataUri = logo;
  return doc;
}

/** 出力ファイルのパスを決める。同名があれば -2, -3 と枝番を付ける */
export function resolveOutputPath(
  config: Config,
  doc: InvoiceDoc,
  issueDate: Date,
  override?: string,
): string {
  if (override) {
    const p = path.resolve(override);
    ensureDir(path.dirname(p));
    return p;
  }
  const dir = ensureDir(resolveOutputDir(config, issueDate));
  const base = safeFileName(
    config.fileNamePattern
      .replace(/\{no\}/g, doc.invoiceNo)
      .replace(/\{client\}/g, doc.client.name)
      .replace(/\{date\}/g, doc.issueDateISO)
      .replace(/\{year\}/g, String(issueDate.getFullYear()))
      .replace(/\{month\}/g, String(issueDate.getMonth() + 1).padStart(2, "0"))
      .replace(/\{issuer\}/g, config.issuer.name),
  );

  let candidate = path.join(dir, `${base}.pdf`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${n}.pdf`);
    n += 1;
  }
  return candidate;
}

export interface IssueResult {
  pdfPath: string;
  doc: InvoiceDoc;
  fit: FitResult;
  hook: HookResult;
  entry: LedgerEntry;
}

/** PDFを書き出し、発行後フックまで走らせる */
export function issueInvoice(
  config: Config,
  doc: InvoiceDoc,
  issueDate: Date,
  outOverride?: string,
): IssueResult {
  const pdfPath = resolveOutputPath(config, doc, issueDate, outOverride);
  const fit = buildPdf(doc, config, pdfPath);
  const entry = recordIssue(doc, pdfPath, config.theme);
  const hook = runAfterIssue(config, doc, pdfPath);
  return { pdfPath, doc, fit, hook, entry };
}
