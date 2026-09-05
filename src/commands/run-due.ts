/**
 * run-due — 「今日が発行日」の取引先をまとめて発行する。
 * 定期実行(launchd / cron / タスクスケジューラ)から毎日呼ばれる。
 *
 * メール送信は、取引先ごとに schedule.email: true を明示した場合だけ。
 * 既定は PDF の発行までで止める。
 */
import fs from "node:fs";
import path from "node:path";
import type { Client, Config, LineItem } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { formatISO, formatJP, matchesScheduleDay, parseDue } from "../core/dates.js";
import { buildInvoiceDoc, issueInvoice } from "../core/invoice.js";
import { nextInvoiceNo, rollbackInvoiceNo } from "../core/numbering.js";
import { scheduledClients, saveClient } from "../core/store.js";
import { buildMailBody } from "../mail/body.js";
import { checkMailReady, sendMail } from "../mail/index.js";
import { markEmailed } from "../core/ledger.js";
import { ensureDir, logsDir } from "../core/paths.js";
import * as ui from "../core/ui.js";

export interface RunDueArgs {
  date?: string;
  "dry-run"?: boolean;
  yes?: boolean;
  client?: string;
}

function itemsFor(client: Client): LineItem[] {
  const s = client.schedule;
  if (s?.item && (s.amount !== undefined || s.qty !== undefined)) {
    const item: LineItem = { name: s.item };
    if (s.amount !== undefined) item.amount = s.amount;
    if (s.qty !== undefined) item.qty = s.qty;
    if (s.unit) item.unit = s.unit;
    if (s.taxRate !== undefined) item.taxRate = s.taxRate;
    return [item];
  }
  if (client.defaults?.items?.length) return client.defaults.items;
  throw new Error(
    `「${client.name}」の定期発行の明細が決まっていません（schedule.item と schedule.amount を設定してください）`,
  );
}

function appendLog(line: string): void {
  const file = path.join(
    ensureDir(logsDir()),
    `run-due_${new Date().toISOString().slice(0, 7)}.log`,
  );
  fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, "utf-8");
}

export async function runDue(args: RunDueArgs): Promise<number> {
  const config: Config = loadConfig();
  const today = args.date ? (parseDue(args.date, new Date()) ?? new Date()) : new Date();
  const dryRun = Boolean(args["dry-run"]);

  const targets = scheduledClients().filter((c) => {
    if (args.client && c.name !== args.client) return false;
    return matchesScheduleDay(c.schedule?.day ?? 0, today);
  });

  ui.heading(
    `${formatJP(today)} が発行日の取引先: ${targets.length}件${dryRun ? ui.c.yellow("（下見だけ）") : ""}`,
  );

  if (targets.length === 0) {
    ui.info("今日発行する請求書はありません。");
    if (!dryRun) appendLog("対象なし");
    return 0;
  }

  let issued = 0;
  let mailed = 0;
  let failed = 0;

  for (const client of targets) {
    const schedule = client.schedule!;
    let items: LineItem[];
    try {
      items = itemsFor(client);
    } catch (e) {
      ui.fail((e as Error).message);
      appendLog(`ERROR ${client.name}: ${(e as Error).message}`);
      failed += 1;
      continue;
    }

    const dueDate =
      parseDue(schedule.due ?? client.defaults?.due ?? "月末", today) ?? today;

    if (dryRun) {
      const preview = items
        .map((i) => `${i.name} ${i.amount ? ui.yen(i.amount) : ""}`)
        .join(" / ");
      ui.info(
        `${client.name}  ${preview}  支払期限 ${formatJP(dueDate)}` +
          (schedule.email ? ui.c.cyan("  → メールも送ります") : ""),
      );
      continue;
    }

    const invoiceNo = nextInvoiceNo(config.invoiceNoPattern, today);
    try {
      const doc = buildInvoiceDoc({
        config,
        client,
        items,
        invoiceNo,
        issueDate: today,
        dueDate,
      });
      const result = issueInvoice(config, doc, today);
      issued += 1;
      ui.ok(
        `${client.name}  ${result.entry.invoiceNo}  ${ui.yen(result.entry.payable)}  → ${result.pdfPath}`,
      );
      appendLog(
        `ISSUED ${client.name} ${result.entry.invoiceNo} ${result.entry.payable} ${result.pdfPath}`,
      );

      // メールは「送る」と明示した取引先だけ
      if (schedule.email) {
        if (!client.email) {
          ui.warn(`${client.name}: メール送信の設定がありますが、宛先アドレスが未登録です`);
          appendLog(`MAIL_SKIP ${client.name} 宛先未登録`);
        } else {
          const problem = checkMailReady(config);
          if (problem) {
            ui.warn(`${client.name}: ${problem}`);
            appendLog(`MAIL_SKIP ${client.name} ${problem}`);
          } else {
            const body = buildMailBody(config, result.entry, client.contact);
            const sent = await sendMail(config, {
              to: client.email,
              ...(config.mail?.bcc ? { bcc: config.mail.bcc } : {}),
              subject: body.subject,
              text: body.text,
              attachmentPath: result.pdfPath,
              fromName: config.mail?.fromName ?? config.issuer.name,
              fromEmail: config.mail?.fromEmail as string,
            });
            if (sent.ok) {
              markEmailed(result.entry.invoiceNo, client.email);
              mailed += 1;
              ui.ok(`  メール送信: ${client.email}`);
              appendLog(`MAILED ${client.name} ${client.email}`);
            } else {
              ui.fail(`  メール送信に失敗: ${sent.error}`);
              appendLog(`MAIL_ERROR ${client.name} ${sent.error}`);
            }
          }
        }
      }

      // 次回のために最終発行日を覚えておく
      saveClient({ ...client, updatedAt: new Date().toISOString() });
    } catch (e) {
      rollbackInvoiceNo(config.invoiceNoPattern, today);
      failed += 1;
      ui.fail(`${client.name}: ${(e as Error).message}`);
      appendLog(`ERROR ${client.name}: ${(e as Error).message}`);
    }
  }

  if (dryRun) {
    console.log("");
    ui.info("下見なので、まだ何も発行していません。実行するには --dry-run を外してください。");
    return 0;
  }

  console.log("");
  ui.info(
    `発行 ${issued}件 / メール ${mailed}件${failed ? ui.c.red(` / 失敗 ${failed}件`) : ""}  （${formatISO(today)}）`,
  );
  appendLog(`DONE issued=${issued} mailed=${mailed} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}
