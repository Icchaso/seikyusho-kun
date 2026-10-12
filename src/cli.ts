#!/usr/bin/env node
/**
 * 請求書くん (seikyusho-kun)
 * 宛先・名目・金額・締日の4つで請求書PDFを出す。
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { fileURLToPath } from "node:url";
import { runNew, type NewArgs } from "./commands/new.js";
import { runMitsumori, type MitsumoriArgs } from "./commands/mitsumori.js";
import { extractItemArgs } from "./core/parse.js";
import { runInit } from "./commands/init.js";
import { runClients } from "./commands/clients.js";
import { runTheme } from "./commands/theme.js";
import { runDoctor } from "./commands/doctor.js";
import { runSend, type SendArgs } from "./commands/send.js";
import { runSchedule, type ScheduleArgs } from "./commands/schedule.js";
import { runDue, type RunDueArgs } from "./commands/run-due.js";
import { runList, type ListArgs } from "./commands/list.js";
import { ChromeNotFoundError, ChromeRunError } from "./core/chrome.js";
import type { LineItem } from "./core/types.js";
import * as ui from "./core/ui.js";

type Opts = NonNullable<ParseArgsConfig["options"]>;

const S = (multiple = false) => ({ type: "string" as const, multiple });
const B = () => ({ type: "boolean" as const });

const OPTIONS: Record<string, Opts> = {
  new: {
    to: S(),
    contact: S(),
    notes: S(true),
    due: S(),
    "from-quote": S(),
    "issue-date": S(),
    no: S(),
    out: S(),
    theme: S(),
    html: B(),
    open: B(),
    save: B(),
    "no-save": B(),
    yes: { type: "boolean", short: "y" },
  },
  mitsumori: {
    to: S(),
    contact: S(),
    notes: S(true),
    valid: S(),
    delivery: S(),
    format: S(),
    revisions: S(),
    expenses: S(),
    "expenses-note": S(),
    "issue-date": S(),
    no: S(),
    out: S(),
    theme: S(),
    limit: S(),
    html: B(),
    open: B(),
    save: B(),
    "no-save": B(),
    yes: { type: "boolean", short: "y" },
  },
  init: { force: B() },
  clients: { yes: { type: "boolean", short: "y" } },
  theme: { as: S(), out: S() },
  doctor: {},
  list: { limit: S(), unpaid: B() },
  send: {
    to: S(),
    no: S(),
    pdf: S(),
    bcc: S(),
    setup: B(),
    "eject-template": B(),
    "no-attachment": B(),
    yes: { type: "boolean", short: "y" },
  },
  schedule: { at: S(), yes: { type: "boolean", short: "y" } },
  "run-due": {
    date: S(),
    client: S(),
    "dry-run": B(),
    yes: { type: "boolean", short: "y" },
  },
};

function version(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(here, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `
${ui.c.bold("請求書くん")} ${ui.dim("(seikyusho-kun)")} — 宛先・名目・金額・締日の4つで請求書PDFを出す

${ui.c.bold("はじめかた")}
  seikyusho-kun init                  自分の情報を登録する（最初に1回だけ）
  seikyusho-kun new                   請求書を発行する（対話で聞かれます）
  seikyusho-kun mitsumori             見積書を発行する（対話で聞かれます）

${ui.c.bold("コマンドで全部書く場合")}
  seikyusho-kun new --to "株式会社ABC" --item "ホームページ制作費" --amount 150000 --due 月末

${ui.c.bold("コマンド一覧")}
  init                  セットアップ（発行者・振込先・デザイン）
  new                   請求書を発行する
  mitsumori [list]      見積書を発行する / 発行済みの見積書の一覧
  clients [list|add|show|remove]
                        取引先の管理
  theme [list|use|preview|eject]
                        デザインの切り替え・自作テンプレートの書き出し
  list                  発行した請求書の一覧
  doctor                動く状態かを実際にPDFを出して確かめる

${ui.c.bold("使いたい人だけ")}
  send [取引先名]        請求書をメールで送る（既定は文面の確認だけ）
    --setup             メール送信の設定（Resend または SMTP）
    --to <アドレス>      宛先を上書きする（テスト送信に）
    -y, --yes           確認せずに送る
  schedule [list|add|remove|install|uninstall]
                        毎月◯日の自動発行
  run-due               今日が発行日の分をまとめて発行する（自動実行から呼ばれる）
    --dry-run           何が発行されるかを見るだけ
    --date <日付>       日付を指定して試す

${ui.c.bold("new の主なオプション")}
  --to <宛先>           会社名または個人名
  --item <名目>         明細の品名（複数指定すると明細が増えます）
  --amount <金額>       150000 / 15万 / ¥150,000 のどれでも可
  --qty <数量>          既定 1
  --unit <単位>         式 / 回 / 個 / ヶ月 など
  --rate <税率>         10 / 8 / 0（軽減税率は 8）
  --due <締日>          月末 / 翌月末 / 30日後 / 2026-09-30 / 9月30日
  --contact <担当者>    宛名の下に「◯◯ 様」を出す
  --notes <備考>        備考欄（複数指定可）
  --issue-date <日付>   発行日（既定は今日）
  --no <番号>           請求書番号を指定する（採番しない）
  --out <パス>          出力先を指定する
  --theme <名前>        今回だけデザインを変える
  --html                PDFではなくHTMLを出す
  --open                出したPDFをすぐ開く
  --from-quote <番号>   見積書の宛先と明細を引き継いで請求書にする
  -y, --yes             対話せずに実行する（cron向け）

${ui.c.bold("mitsumori の主なオプション")}
  ${ui.dim("new と同じオプション（--to / --item / --amount / --qty / --unit / --rate / --contact / --notes）が使えます")}
  --valid <有効期限>    既定は発行日から1ヶ月後（2ヶ月後 / 翌月末 / 2026-11-30 も可）
  --delivery <納期>     2026-11-30 のような日付でも「ご発注後30日」のような文でも可
  --format <納品形式>   例: MP4 / H.264 / 1920×1080
  --revisions <修正>    例: 初稿提出後2回まで（3回目以降は別途お見積り）
  --expenses <諸経費>   30000 のような金額、または 10% のような率（他の明細の合計に対する比率）
  --expenses-note <文>  諸経費の行に小さく出す内訳

${ui.dim("データの置き場所: ~/.seikyusho-kun/   |   ドキュメント: https://github.com/Icchaso/seikyusho-kun")}
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;

  // バージョンはヘルプより先に見る(--version がヘルプに吸われないように)
  if (argv.includes("--version") || argv.includes("-v") || command === "version") {
    console.log(version());
    return 0;
  }
  if (!command || argv.includes("--help") || argv.includes("-h")) {
    if (!command || !(command in OPTIONS)) {
      console.log(HELP);
      return 0;
    }
  }

  const options = OPTIONS[command as string];
  if (!options) {
    ui.fail(`知らないコマンドです: ${command}`);
    console.log(HELP);
    return 1;
  }

  // 明細(--item / --amount / --qty / --unit / --rate / --note)は
  // 並び順に意味があるので、parseArgs に渡す前に取り出す。
  let commandArgs = argv.slice(1);
  let items: LineItem[] = [];
  if (command === "new" || command === "mitsumori") {
    const extracted = extractItemArgs(commandArgs);
    items = extracted.items;
    commandArgs = extracted.rest;
  }

  const { values, positionals } = parseArgs({
    args: commandArgs,
    options,
    allowPositionals: true,
    strict: true,
  });

  switch (command) {
    case "init":
      return runInit(values as { force?: boolean });
    case "new":
      return runNew({ ...(values as NewArgs), items });
    case "mitsumori":
      return runMitsumori({
        ...(values as Omit<MitsumoriArgs, "_" | "items">),
        items,
        _: positionals,
      });
    case "clients":
      return runClients({ ...(values as { yes?: boolean }), _: positionals });
    case "theme":
      return runTheme({
        ...(values as { as?: string; out?: string }),
        _: positionals,
      });
    case "doctor":
      return runDoctor();
    case "list":
      return runList(values as ListArgs);
    case "send":
      return runSend({ ...(values as Omit<SendArgs, "_">), _: positionals });
    case "schedule":
      return runSchedule({ ...(values as Omit<ScheduleArgs, "_">), _: positionals });
    case "run-due":
      return runDue(values as RunDueArgs);
    default:
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    const err = e as Error;
    console.error("");
    if (err instanceof ChromeNotFoundError || err instanceof ChromeRunError) {
      ui.fail(err.message);
    } else {
      ui.fail(err.message || String(e));
      if (process.env.SEIKYUSHO_DEBUG) console.error(err.stack);
    }
    process.exitCode = 1;
  });
