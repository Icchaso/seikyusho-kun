/**
 * new — 請求書を発行する。
 * 「宛先・名目・金額・締日」の4つが揃えば出せる。足りない分は対話で聞く。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import type { Client, Config, LineItem } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { formatJP, parseDue } from "../core/dates.js";
import { buildInvoiceDoc, issueInvoice, resolveOutputPath } from "../core/invoice.js";
import { nextInvoiceNo, peekInvoiceNo, rollbackInvoiceNo } from "../core/numbering.js";
import { parseAmount, parseTaxRate } from "../core/parse.js";
import { findClient, listClients, saveClient } from "../core/store.js";
import { renderHtml } from "../core/render.js";
import * as ui from "../core/ui.js";

export interface NewArgs {
  to?: string;
  contact?: string;
  /** cli.ts が引数の並び順から組み立てた明細 */
  items?: LineItem[];
  due?: string;
  "issue-date"?: string;
  no?: string;
  out?: string;
  theme?: string;
  notes?: string[];
  html?: boolean;
  open?: boolean;
  save?: boolean;
  "no-save"?: boolean;
  yes?: boolean;
}

function cancelled(): never {
  p.cancel("中止しました。請求書は発行していません。");
  process.exit(130);
}

/** 宛先を決める。保存済みがあれば選ばせ、無ければ入力させる */
async function askClient(preset?: string): Promise<Client> {
  if (preset) {
    const found = findClient(preset);
    if (found) return found;
    return { name: preset };
  }

  const saved = listClients();
  if (saved.length > 0) {
    const choice = await p.select({
      message: "宛先は？",
      options: [
        ...saved.map((cl) => ({
          value: cl.name,
          label: cl.name,
          hint: cl.contact ? `ご担当 ${cl.contact}` : undefined,
        })),
        { value: "__new__", label: "＋ 新しい宛先を入力する" },
      ],
    });
    if (p.isCancel(choice)) cancelled();
    if (choice !== "__new__") {
      return findClient(String(choice)) ?? { name: String(choice) };
    }
  }

  const name = await p.text({
    message: "宛先は？",
    placeholder: "株式会社ABC",
    validate: (v) => (v.trim() ? undefined : "宛先を入力してください"),
  });
  if (p.isCancel(name)) cancelled();
  return { name: String(name).trim() };
}

async function askItems(config: Config): Promise<LineItem[]> {
  const items: LineItem[] = [];
  for (;;) {
    const name = await p.text({
      message: items.length === 0 ? "名目は？" : "次の名目は？（空欄で終了）",
      placeholder: items.length === 0 ? "ホームページ制作費" : "",
      validate: (v) =>
        items.length === 0 && !v.trim() ? "名目を入力してください" : undefined,
    });
    if (p.isCancel(name)) cancelled();
    const label = String(name).trim();
    if (!label) break;

    const amount = await p.text({
      message: `金額は？（${config.tax.mode === "inclusive" ? "税込" : "税抜"}）`,
      placeholder: "150000  /  15万 でも可",
      validate: (v) => {
        try {
          parseAmount(v);
          return undefined;
        } catch {
          return "金額を数字で入力してください";
        }
      },
    });
    if (p.isCancel(amount)) cancelled();

    items.push({ name: label, amount: parseAmount(String(amount)) });

    const more = await p.confirm({
      message: "明細をもう1行足しますか？",
      initialValue: false,
    });
    if (p.isCancel(more)) cancelled();
    if (!more) break;
  }
  return items;
}

async function askDue(issueDate: Date): Promise<Date> {
  const preset = await p.select({
    message: "締日（お支払期限）は？",
    options: [
      {
        value: "月末",
        label: `今月末（${formatJP(parseDue("月末", issueDate) as Date)}）`,
      },
      {
        value: "翌月末",
        label: `翌月末（${formatJP(parseDue("翌月末", issueDate) as Date)}）`,
      },
      {
        value: "30日後",
        label: `30日後（${formatJP(parseDue("30日後", issueDate) as Date)}）`,
      },
      { value: "__input__", label: "日付を直接入力する" },
    ],
  });
  if (p.isCancel(preset)) cancelled();

  if (preset !== "__input__") {
    return parseDue(String(preset), issueDate) as Date;
  }

  const typed = await p.text({
    message: "締日を入力してください",
    placeholder: "2026-09-30 / 9月30日 / 来月10日",
    validate: (v) => (parseDue(v, issueDate) ? undefined : "日付として読めません"),
  });
  if (p.isCancel(typed)) cancelled();
  return parseDue(String(typed), issueDate) as Date;
}

function openFile(file: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(cmd, [file], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
}

export async function runNew(args: NewArgs): Promise<number> {
  const config = loadConfig();
  if (args.theme) config.theme = args.theme;

  const issueDate = args["issue-date"]
    ? (parseDue(args["issue-date"], new Date()) ?? new Date())
    : new Date();

  const interactive = ui.isInteractive() && !args.yes;
  const cliItems = args.items ?? [];
  const hasAll = Boolean(args.to) && cliItems.length > 0 && Boolean(args.due);

  let client: Client;
  let items: LineItem[];
  let dueDate: Date;

  if (hasAll || !interactive) {
    if (!args.to) throw new Error("--to（宛先）が必要です");
    if (cliItems.length === 0) throw new Error("--item と --amount（名目と金額）が必要です");
    if (!args.due) throw new Error("--due（締日）が必要です");
    client = findClient(args.to) ?? { name: args.to };
    items = cliItems;
    const d = parseDue(args.due, issueDate);
    if (!d) throw new Error(`締日として読めません: ${args.due}`);
    dueDate = d;
  } else {
    p.intro(ui.c.bgCyan(ui.c.black(" 請求書くん ")));
    client = await askClient(args.to);
    items = cliItems.length > 0 ? cliItems : await askItems(config);
    dueDate = args.due
      ? (parseDue(args.due, issueDate) ?? (await askDue(issueDate)))
      : await askDue(issueDate);
  }

  if (args.contact) client = { ...client, contact: args.contact };
  // 取引先に既定の明細があり、明細が指定されていなければそれを使う
  if (items.length === 0 && client.defaults?.items?.length) {
    items = client.defaults.items;
  }

  const invoiceNo = args.no ?? nextInvoiceNo(config.invoiceNoPattern, issueDate);
  let doc = buildInvoiceDoc({
    config,
    client,
    items,
    invoiceNo,
    issueDate,
    dueDate,
    ...(args.notes ? { notes: args.notes } : {}),
  });

  // HTML だけ欲しい場合(テンプレを自作する人向け)。
  // 正式な発行ではないので、消費した請求書番号は戻す。
  if (args.html) {
    const out =
      args.out ??
      resolveOutputPath(config, doc, issueDate).replace(/\.pdf$/, ".html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(doc, config), "utf-8");
    if (!args.no) rollbackInvoiceNo(config.invoiceNoPattern, issueDate);
    ui.ok(`HTMLを出力しました: ${out}`);
    ui.info("HTMLは下書きなので、請求書番号は消費していません");
    return 0;
  }

  const spin = interactive ? p.spinner() : null;
  spin?.start("PDFを作っています");
  let result;
  try {
    result = issueInvoice(config, doc, issueDate, args.out);
  } catch (e) {
    spin?.stop("失敗しました");
    if (!args.no) rollbackInvoiceNo(config.invoiceNoPattern, issueDate);
    throw e;
  }
  spin?.stop("できました");
  doc = result.doc;

  const total = doc.totals.payable ?? doc.totals.total;
  const rows: [string, string][] = [
    ["宛先", `${doc.client.name} ${doc.client.honorific}`],
    ["請求書番号", doc.invoiceNo],
    ["発行日", doc.issueDate],
    ["お支払期限", doc.dueDate],
    ["合計（税込）", ui.yen(doc.totals.total)],
  ];
  if (doc.totals.withholding) {
    rows.push(["源泉徴収", `△ ${ui.yen(doc.totals.withholding)}`]);
    rows.push(["お振込金額", ui.yen(total)]);
  }
  rows.push([
    "レイアウト",
    result.fit.pages === 1
      ? `A4 1ページ（密度 ${result.fit.density}）`
      : `A4 ${result.fit.pages}ページ（密度 ${result.fit.density}）`,
  ]);

  console.log("");
  ui.ok(`発行しました: ${ui.c.bold(result.pdfPath)}`);
  ui.kv(rows);

  if (result.hook.ran) {
    if (result.hook.ok) ui.info("発行後フックを実行しました");
    else ui.warn(`発行後フックが失敗しました:\n${result.hook.output}`);
  }

  // 新しい取引先なら保存しておく(次回から選ぶだけで出せる)
  const known = findClient(client.name);
  if (!known && !args["no-save"]) {
    let save = args.save ?? true;
    if (interactive && args.save === undefined) {
      const r = await p.confirm({
        message: `「${client.name}」を取引先として保存しますか？`,
        initialValue: true,
      });
      if (p.isCancel(r)) save = false;
      else save = r;
    }
    if (save) {
      saveClient(client);
      ui.info(`取引先に保存しました（次回は宛先を選ぶだけで出せます）`);
    }
  }

  if (args.open) openFile(result.pdfPath);
  if (interactive) {
    p.outro(ui.dim(`次の請求書番号は ${peekInvoiceNo(config.invoiceNoPattern, new Date())} です`));
  }
  return 0;
}
