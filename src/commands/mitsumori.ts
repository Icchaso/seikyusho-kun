/**
 * mitsumori — 見積書を発行する。
 * 「宛先・名目・金額」が揃えば出せる。有効期限は既定(発行日から1ヶ月後)を使う。
 * 受注したら `seikyusho-kun new --from-quote <見積書番号>` で請求書に変換できる。
 */
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import type { Client, Config, LineItem } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { formatJP, parseDue } from "../core/dates.js";
import { resolveOutputPath } from "../core/invoice.js";
import {
  nextQuoteNo,
  peekQuoteNo,
  rollbackQuoteNo,
} from "../core/numbering.js";
import { askClient, askItems, cancelled } from "../core/prompts.js";
import { buildExpenseItem, buildQuoteDoc, issueQuote } from "../core/quote.js";
import { readQuotes } from "../core/quote-ledger.js";
import { renderHtml } from "../core/render.js";
import { findClient, saveClient } from "../core/store.js";
import * as ui from "../core/ui.js";

export interface MitsumoriArgs {
  _: string[];
  to?: string;
  contact?: string;
  /** cli.ts が引数の並び順から組み立てた明細 */
  items?: LineItem[];
  /** 有効期限 */
  valid?: string;
  /** 納期 */
  delivery?: string;
  /** 納品形式 */
  format?: string;
  /** 修正回数の条件 */
  revisions?: string;
  /** 諸経費。金額(30000)でも率(10%)でもよい */
  expenses?: string;
  /** 諸経費の行に出す内訳 */
  "expenses-note"?: string;
  notes?: string[];
  "issue-date"?: string;
  no?: string;
  out?: string;
  theme?: string;
  html?: boolean;
  open?: boolean;
  save?: boolean;
  "no-save"?: boolean;
  limit?: string;
  yes?: boolean;
}

const WHAT = "見積書";

/** 有効期限を聞く。既定は設定の validFor(1ヶ月後) */
async function askValidUntil(issueDate: Date, config: Config): Promise<Date> {
  const label = (spec: string): string => {
    const d = parseDue(spec, issueDate);
    return d ? `（${formatJP(d)}）` : "";
  };
  const preset = await p.select({
    message: "見積書の有効期限は？",
    options: [
      {
        value: config.quote.validFor,
        label: `${config.quote.validFor}${label(config.quote.validFor)}`,
        hint: "既定",
      },
      { value: "14日後", label: `2週間後${label("14日後")}` },
      { value: "翌月末", label: `翌月末${label("翌月末")}` },
      { value: "__input__", label: "日付を直接入力する" },
    ],
  });
  if (p.isCancel(preset)) cancelled(WHAT);

  if (preset !== "__input__") {
    const d = parseDue(String(preset), issueDate);
    if (d) return d;
  }

  const typed = await p.text({
    message: "有効期限を入力してください",
    placeholder: "2026-11-30 / 11月30日 / 2ヶ月後",
    validate: (v) => (parseDue(v, issueDate) ? undefined : "日付として読めません"),
  });
  if (p.isCancel(typed)) cancelled(WHAT);
  return parseDue(String(typed), issueDate) as Date;
}

/** 納期の指定。日付として読めれば日付表示にし、読めなければ文字列のまま出す */
function formatDelivery(input: string, base: Date): string {
  const d = parseDue(input, base);
  return d ? formatJP(d) : input.trim();
}

/** 発行済みの見積書の一覧 */
function listQuotes(limitArg?: string): number {
  const limit = Number(limitArg ?? 20);
  const entries = readQuotes().slice(0, Number.isFinite(limit) ? limit : 20);

  if (entries.length === 0) {
    ui.info("まだ見積書を発行していません。");
    ui.info(`発行する: ${ui.c.cyan("seikyusho-kun mitsumori")}`);
    return 0;
  }

  ui.heading(`発行済みの見積書（新しい順に ${entries.length}件）`);
  ui.kv(
    entries.map((e): [string, string] => [
      e.quoteNo,
      [
        e.issueDate,
        e.client.name,
        ui.yen(e.total),
        `有効 ${e.validUntil}`,
        e.invoicedNo
          ? ui.c.green(`請求済 ${e.invoicedNo}`)
          : ui.dim("未請求"),
      ].join("  "),
    ]),
  );
  console.log("");
  ui.info(
    `請求書にする: ${ui.c.cyan("seikyusho-kun new --from-quote <見積書番号> --due 月末")}`,
  );
  return 0;
}

export async function runMitsumori(args: MitsumoriArgs): Promise<number> {
  const [sub] = args._;
  if (sub === "list") return listQuotes(args.limit);

  const config = loadConfig();
  if (args.theme) config.theme = args.theme;

  // 位置引数は宛先として受ける（mitsumori ABC社 --item ... と書けるように）
  const to = args.to ?? (sub && sub !== "list" ? sub : undefined);

  const issueDate = args["issue-date"]
    ? (parseDue(args["issue-date"], new Date()) ?? new Date())
    : new Date();

  const interactive = ui.isInteractive() && !args.yes;
  const cliItems = args.items ?? [];
  const hasAll = Boolean(to) && cliItems.length > 0;

  let client: Client;
  let items: LineItem[];
  let validUntil: Date;

  if (hasAll || !interactive) {
    if (!to) throw new Error("--to（宛先）が必要です");
    if (cliItems.length === 0) {
      throw new Error("--item と --amount（名目と金額）が必要です");
    }
    client = findClient(to) ?? { name: to };
    items = cliItems;
    const spec = args.valid ?? config.quote.validFor;
    const d = parseDue(spec, issueDate);
    if (!d) throw new Error(`有効期限として読めません: ${spec}`);
    validUntil = d;
  } else {
    p.intro(ui.c.bgCyan(ui.c.black(" 見積書くん ")));
    client = await askClient(to, WHAT);
    items = cliItems.length > 0 ? cliItems : await askItems(config, WHAT);
    validUntil = args.valid
      ? (parseDue(args.valid, issueDate) ?? (await askValidUntil(issueDate, config)))
      : await askValidUntil(issueDate, config);
  }

  if (args.contact) client = { ...client, contact: args.contact };
  if (items.length === 0 && client.defaults?.items?.length) {
    items = client.defaults.items;
  }

  // 諸経費の行を足す（金額でも「10%」のような率でもよい）
  if (args.expenses) {
    items = [
      ...items,
      buildExpenseItem(args.expenses, items, config, args["expenses-note"]),
    ];
  }

  const quoteNo = args.no ?? nextQuoteNo(config.quote.noPattern, issueDate);
  const doc = buildQuoteDoc({
    config,
    client,
    items,
    quoteNo,
    issueDate,
    validUntil,
    ...(args.delivery
      ? { delivery: formatDelivery(args.delivery, issueDate) }
      : {}),
    ...(args.format ? { deliveryFormat: args.format } : {}),
    ...(args.revisions ? { revisions: args.revisions } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  });

  // HTML だけ欲しい場合。正式な発行ではないので、消費した番号は戻す。
  if (args.html) {
    const out =
      args.out ??
      resolveOutputPath(config, doc, issueDate).replace(/\.pdf$/, ".html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(doc, config), "utf-8");
    if (!args.no) rollbackQuoteNo(config.quote.noPattern, issueDate);
    ui.ok(`HTMLを出力しました: ${out}`);
    ui.info("HTMLは下書きなので、見積書番号は消費していません");
    return 0;
  }

  const spin = interactive ? p.spinner() : null;
  spin?.start("PDFを作っています");
  let result;
  try {
    result = issueQuote(config, doc, client, items, issueDate, args.out);
  } catch (e) {
    spin?.stop("失敗しました");
    if (!args.no) rollbackQuoteNo(config.quote.noPattern, issueDate);
    throw e;
  }
  spin?.stop("できました");

  const rows: [string, string][] = [
    ["宛先", `${result.doc.client.name} ${result.doc.client.honorific}`],
    ["見積書番号", result.doc.invoiceNo],
    ["発行日", result.doc.issueDate],
    ["有効期限", result.doc.terms?.validUntil ?? ""],
    ["合計（税込）", ui.yen(result.doc.totals.total)],
  ];
  if (result.doc.terms?.delivery) rows.push(["納期", result.doc.terms.delivery]);
  if (result.doc.terms?.deliveryFormat) {
    rows.push(["納品形式", result.doc.terms.deliveryFormat]);
  }
  if (result.doc.terms?.revisions) {
    rows.push(["修正回数", result.doc.terms.revisions]);
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
      ui.info("取引先に保存しました（次回は宛先を選ぶだけで出せます）");
    }
  }

  if (args.open) ui.openFile(result.pdfPath);

  console.log("");
  ui.info(
    `受注したら: ${ui.c.cyan(`seikyusho-kun new --from-quote ${result.doc.invoiceNo} --due 月末`)}`,
  );
  if (interactive) {
    p.outro(
      ui.dim(`次の見積書番号は ${peekQuoteNo(config.quote.noPattern, new Date())} です`),
    );
  }
  return 0;
}
