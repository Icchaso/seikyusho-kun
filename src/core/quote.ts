/**
 * 入力 → 見積書ドキュメント → PDF の組み立て。
 *
 * 見積書は請求書と同じ骨格(明細・税計算・A4オートフィット)を使いまわし、
 * 違うところだけここで足している。
 *  - 振込先は出さない(まだ支払いの段階ではない)
 *  - 源泉徴収は引かない(見積は総額を示すのが通例)
 *  - 「お支払期限」の代わりに「有効期限」と、納期・納品形式・修正回数の条件欄
 */
import type {
  Client,
  Config,
  InvoiceDoc,
  LineItem,
  QuoteTerms,
} from "./types.js";
import { buildInvoiceDoc, resolveOutputPath } from "./invoice.js";
import { applyRounding } from "./money.js";
import { parseAmount, toHalfWidth } from "./parse.js";
import { formatISO, formatJP } from "./dates.js";
import { buildPdf, type FitResult } from "./autofit.js";
import { runAfterIssue, type HookResult } from "./hooks.js";
import { recordQuote, type QuoteEntry } from "./quote-ledger.js";

export interface BuildQuoteParams {
  config: Config;
  client: Client;
  items: LineItem[];
  quoteNo: string;
  issueDate: Date;
  /** 有効期限 */
  validUntil: Date;
  /** 納期。日付でも「ご発注後30日」のような自由文でもよい */
  delivery?: string;
  /** 納品形式 (例: MP4 / H.264 / 1920×1080) */
  deliveryFormat?: string;
  /** 修正回数の条件 (例: 初稿提出後2回まで) */
  revisions?: string;
  notes?: string[];
  greeting?: string;
}

export function buildQuoteDoc(p: BuildQuoteParams): InvoiceDoc {
  const { config } = p;

  // 見積書では源泉徴収を引かず、挨拶文と備考も見積書用の既定に差し替える
  const quoteConfig: Config = {
    ...config,
    tax: { ...config.tax, withholding: false },
    greeting: config.quote.greeting,
    notes: config.quote.notes,
  };

  const base = buildInvoiceDoc({
    config: quoteConfig,
    client: p.client,
    items: p.items,
    invoiceNo: p.quoteNo,
    issueDate: p.issueDate,
    // 「有効期限」を入れる。テンプレートは terms 側を見るが、
    // ファイル名や台帳の既定値として dueDate も埋めておく
    dueDate: p.validUntil,
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.greeting ? { greeting: p.greeting } : {}),
  });

  const delivery = p.delivery?.trim();
  const deliveryFormat = (
    p.deliveryFormat ?? config.quote.deliveryFormat
  )?.trim();
  const revisions = (p.revisions ?? config.quote.revisions)?.trim();

  const terms: QuoteTerms = {
    validUntil: formatJP(p.validUntil),
    validUntilISO: formatISO(p.validUntil),
    ...(delivery ? { delivery } : {}),
    ...(deliveryFormat ? { deliveryFormat } : {}),
    ...(revisions ? { revisions } : {}),
  };

  return { ...base, kind: "quote", terms };
}

/**
 * --expenses の指定から諸経費の明細を1行作る。
 * 「30000」のような金額と、「10%」のような率(ほかの明細の合計に対する比率)の両方を受ける。
 * 率で指定されたときは、消費税と同じ端数処理の設定に従う。
 */
export function buildExpenseItem(
  spec: string,
  items: LineItem[],
  config: Config,
  note?: string,
): LineItem {
  const s = toHalfWidth(String(spec).trim());
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*[%％]$/);

  let amount: number;
  if (pct?.[1]) {
    const base = items.reduce((sum, item) => {
      const qty = item.qty ?? 1;
      const value = item.amount ?? qty * (item.unitPrice ?? 0);
      return sum + value;
    }, 0);
    if (base <= 0) {
      throw new Error(
        "諸経費を率で指定するには、先に明細（--item と --amount）が必要です",
      );
    }
    amount = applyRounding((base * Number(pct[1])) / 100, config.tax.rounding);
  } else {
    amount = parseAmount(s);
  }

  const text = note ?? config.quote.expenseNote;
  return {
    name: config.quote.expenseLabel,
    qty: 1,
    unit: "式",
    amount,
    ...(text ? { note: text } : {}),
  };
}

export interface QuoteResult {
  pdfPath: string;
  doc: InvoiceDoc;
  fit: FitResult;
  hook: HookResult;
  entry: QuoteEntry;
}

/** PDFを書き出し、見積台帳に記録して、発行後フックまで走らせる */
export function issueQuote(
  config: Config,
  doc: InvoiceDoc,
  client: Client,
  items: LineItem[],
  issueDate: Date,
  outOverride?: string,
): QuoteResult {
  const pdfPath = resolveOutputPath(config, doc, issueDate, outOverride);
  const fit = buildPdf(doc, config, pdfPath);
  const entry = recordQuote(doc, client, items, pdfPath, config.theme);
  const hook = runAfterIssue(config, doc, pdfPath);
  return { pdfPath, doc, fit, hook, entry };
}
