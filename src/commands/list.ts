/** list — 発行した請求書の一覧 */
import { readLedger } from "../core/ledger.js";
import * as ui from "../core/ui.js";

export interface ListArgs {
  limit?: string;
  unpaid?: boolean;
}

export async function runList(args: ListArgs): Promise<number> {
  const limit = Number(args.limit ?? 20);
  const entries = readLedger().slice(0, Number.isFinite(limit) ? limit : 20);

  if (entries.length === 0) {
    ui.info("まだ請求書を発行していません。");
    ui.info(`発行する: ${ui.c.cyan("seikyusho-kun new")}`);
    return 0;
  }

  ui.heading(`発行済みの請求書（新しい順に ${entries.length}件）`);
  ui.kv(
    entries.map((e): [string, string] => [
      e.invoiceNo,
      [
        e.issueDate,
        e.client,
        ui.yen(e.payable),
        `期限 ${e.dueDate}`,
        e.emailedAt ? ui.c.green(`送信済 ${e.emailedAt.slice(0, 10)}`) : ui.dim("未送信"),
      ].join("  "),
    ]),
  );
  console.log("");
  ui.info(`メールで送る: ${ui.c.cyan("seikyusho-kun send <取引先名>")}`);
  return 0;
}
