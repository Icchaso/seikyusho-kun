/** 発行後フック。freee など外部連携を各自で外付けするための出口 */
import { spawnSync } from "node:child_process";
import type { Config, InvoiceDoc } from "./types.js";
import { expandTilde } from "./paths.js";

export interface HookResult {
  ran: boolean;
  ok: boolean;
  output: string;
}

/**
 * config.hooks.afterIssue に書かれたコマンドを、発行内容を環境変数で渡して実行する。
 * 失敗しても請求書自体は発行済みなので、例外にはせず結果を返す。
 */
export function runAfterIssue(
  config: Config,
  doc: InvoiceDoc,
  pdfPath: string,
): HookResult {
  const cmd = config.hooks?.afterIssue;
  if (!cmd) return { ran: false, ok: true, output: "" };

  const r = spawnSync(expandTilde(cmd), {
    shell: true,
    encoding: "utf-8",
    timeout: 120_000,
    env: {
      ...process.env,
      INVOICE_PDF: pdfPath,
      INVOICE_NO: doc.invoiceNo,
      INVOICE_ISSUE_DATE: doc.issueDateISO,
      INVOICE_DUE_DATE: doc.dueDateISO,
      CLIENT_NAME: doc.client.name,
      INVOICE_SUBTOTAL: String(doc.totals.subtotal),
      INVOICE_TAX: String(doc.totals.taxTotal),
      INVOICE_TOTAL: String(doc.totals.total),
      INVOICE_PAYABLE: String(doc.totals.payable ?? doc.totals.total),
      INVOICE_JSON: JSON.stringify(doc),
    },
  });

  return {
    ran: true,
    ok: r.status === 0,
    output: [r.stdout, r.stderr].filter(Boolean).join("\n").trim(),
  };
}
