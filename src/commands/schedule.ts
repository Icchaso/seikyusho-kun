/**
 * schedule — 「毎月◯日に自動で発行する」の設定と、OSへの登録。
 * メール自動送信は取引先ごとに明示して初めて有効になる（既定はPDFだけ）。
 */
import * as p from "@clack/prompts";
import type { Client, Schedule } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { formatJP, parseDue } from "../core/dates.js";
import { findClient, listClients, saveClient, scheduledClients } from "../core/store.js";
import { parseAmount } from "../core/parse.js";
import { checkMailReady } from "../mail/index.js";
import {
  installSchedule,
  scheduleStatus,
  uninstallSchedule,
} from "../scheduler/index.js";
import * as ui from "../core/ui.js";

export interface ScheduleArgs {
  _: string[];
  at?: string;
  yes?: boolean;
}

function cancelled(): never {
  p.cancel("中止しました。");
  process.exit(130);
}

function describeDay(day: number | "末日"): string {
  return day === "末日" ? "毎月末日" : `毎月${day}日`;
}

function list(): number {
  const status = scheduleStatus();
  const clients = scheduledClients();

  ui.heading("定期発行");
  console.log(
    `${status.installed ? ui.c.green("✔") : ui.c.yellow("!")} 自動実行  ${ui.dim(
      status.installed
        ? `${status.detail}（${status.location}）`
        : `${status.detail} — \`seikyusho-kun schedule install\` で登録できます`,
    )}`,
  );

  console.log("");
  if (clients.length === 0) {
    ui.info("定期発行が設定された取引先はありません。");
    ui.info(`設定する: ${ui.c.cyan("seikyusho-kun schedule add <取引先名>")}`);
    return 0;
  }

  ui.kv(
    clients.map((c): [string, string] => {
      const s = c.schedule as Schedule;
      const amount = s.amount ? ui.yen(s.amount) : "";
      const mail = s.email
        ? ui.c.cyan(`メール送信あり → ${c.email ?? ui.c.red("宛先未登録")}`)
        : ui.dim("メールは送らない");
      return [
        c.name,
        `${describeDay(s.day)}  ${s.item ?? ""} ${amount}  支払期限 ${s.due ?? "月末"}  ${mail}`,
      ];
    }),
  );
  console.log("");
  ui.info(`今日の対象を確認する: ${ui.c.cyan("seikyusho-kun run-due --dry-run")}`);
  return 0;
}

async function add(name?: string): Promise<number> {
  ui.requireInteractive("定期発行の設定");
  const config = loadConfig();
  p.intro(ui.c.bgCyan(ui.c.black(" 定期発行の設定 ")));

  let client: Client | null = name ? findClient(name) : null;
  if (!client) {
    const all = listClients();
    if (all.length === 0) {
      p.cancel(
        "取引先がまだありません。先に `seikyusho-kun new` で1枚発行するか、`seikyusho-kun clients add` で登録してください。",
      );
      return 1;
    }
    const choice = await p.select({
      message: "どの取引先ですか？",
      options: all.map((c) => ({ value: c.name, label: c.name })),
    });
    if (p.isCancel(choice)) cancelled();
    client = findClient(String(choice));
  }
  if (!client) {
    p.cancel(`取引先「${name}」が見つかりません`);
    return 1;
  }

  const dayChoice = await p.select({
    message: "毎月いつ発行しますか？",
    options: [
      { value: "末日", label: "末日", hint: "月末締めの定番" },
      { value: "1", label: "1日" },
      { value: "15", label: "15日" },
      { value: "20", label: "20日" },
      { value: "25", label: "25日" },
      { value: "__input__", label: "日付を入力する" },
    ],
    initialValue: String(client.schedule?.day ?? "末日"),
  });
  if (p.isCancel(dayChoice)) cancelled();

  let day: number | "末日";
  if (dayChoice === "__input__") {
    const typed = await p.text({
      message: "何日に発行しますか？（1〜31）",
      validate: (v) => {
        const n = Number(v);
        return n >= 1 && n <= 31 ? undefined : "1〜31 の数字で入力してください";
      },
    });
    if (p.isCancel(typed)) cancelled();
    day = Number(typed);
  } else {
    day = dayChoice === "末日" ? "末日" : Number(dayChoice);
  }

  const item = await p.text({
    message: "毎月の名目は？",
    placeholder: "サイト保守・運用費",
    initialValue: client.schedule?.item ?? "",
    validate: (v) => (v.trim() ? undefined : "入力してください"),
  });
  if (p.isCancel(item)) cancelled();

  const amount = await p.text({
    message: `毎月の金額は？（${config.tax.mode === "inclusive" ? "税込" : "税抜"}）`,
    placeholder: "5000",
    initialValue: client.schedule?.amount ? String(client.schedule.amount) : "",
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

  const due = await p.select({
    message: "支払期限は？",
    options: [
      { value: "月末", label: "発行月の末日" },
      { value: "翌月末", label: "翌月末" },
      { value: "30日後", label: "発行日から30日後" },
    ],
    initialValue: client.schedule?.due ?? "月末",
  });
  if (p.isCancel(due)) cancelled();

  const mailProblem = checkMailReady(config);
  let email = false;
  if (mailProblem) {
    p.note(
      `メール送信が使えないため、PDFの発行だけを自動化します。\n${mailProblem}`,
      "メールについて",
    );
  } else if (!client.email) {
    p.note(
      `「${client.name}」に送付先メールが登録されていないため、PDFの発行だけを自動化します。\n` +
        `後から \`seikyusho-kun clients add "${client.name}"\` で登録できます。`,
      "メールについて",
    );
  } else {
    const answer = await p.confirm({
      message: `発行後、${client.email} へ自動でメール送信しますか？（人の確認なしで送られます）`,
      initialValue: false,
    });
    if (p.isCancel(answer)) cancelled();
    email = answer;
  }

  const schedule: Schedule = {
    day,
    item: String(item).trim(),
    amount: parseAmount(String(amount)),
    due: String(due),
    email,
    enabled: true,
  };
  saveClient({ ...client, schedule });

  const nextDate = parseDue(day === "末日" ? "月末" : `${day}日`, new Date());
  const status = scheduleStatus();
  p.note(
    [
      `${client.name}：${describeDay(day)} に「${schedule.item}」${ui.yen(schedule.amount as number)} を発行`,
      email ? "発行後に自動でメール送信します" : "メールは送りません（PDFの発行のみ）",
      nextDate ? `次回の発行予定: ${formatJP(nextDate)}` : "",
      "",
      status.installed
        ? ui.c.green("自動実行はすでに登録されています")
        : ui.c.yellow("まだ自動実行が登録されていません → `seikyusho-kun schedule install`"),
    ]
      .filter(Boolean)
      .join("\n"),
    "設定しました",
  );
  p.outro(`確認: ${ui.c.cyan("seikyusho-kun run-due --dry-run")}`);
  return 0;
}

function remove(name: string): number {
  const client = findClient(name);
  if (!client?.schedule) {
    ui.fail(`「${name}」に定期発行の設定はありません`);
    return 1;
  }
  const { schedule: _removed, ...rest } = client;
  saveClient(rest);
  ui.ok(`${client.name} の定期発行を解除しました`);
  return 0;
}

function install(at?: string): number {
  let hour = 9;
  let minute = 0;
  if (at) {
    const m = at.match(/^(\d{1,2}):(\d{2})$/);
    if (!m?.[1] || !m[2]) throw new Error("--at は HH:MM の形式で指定してください（例: --at 9:00）");
    hour = Number(m[1]);
    minute = Number(m[2]);
  }
  const status = installSchedule(hour, minute);
  ui.ok(`自動実行を登録しました（${status.detail}）`);
  if (status.location) ui.kv([["登録先", status.location]]);
  console.log("");
  ui.info("毎日この時刻に、発行日を迎えた取引先の請求書が自動で作られます");
  ui.info(`解除する: ${ui.c.cyan("seikyusho-kun schedule uninstall")}`);
  return 0;
}

function uninstall(): number {
  uninstallSchedule();
  ui.ok("自動実行を解除しました（取引先ごとの設定はそのまま残ります）");
  return 0;
}

export async function runSchedule(args: ScheduleArgs): Promise<number> {
  const [sub, arg] = args._;
  switch (sub) {
    case undefined:
    case "list":
    case "status":
      return list();
    case "add":
    case "set":
      return add(arg);
    case "remove":
    case "rm":
      if (!arg) throw new Error("取引先名を指定してください");
      return remove(arg);
    case "install":
      return install(args.at);
    case "uninstall":
      return uninstall();
    default:
      throw new Error(
        `schedule のサブコマンドは list / add / remove / install / uninstall です（受け取った値: ${sub}）`,
      );
  }
}
