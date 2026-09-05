/**
 * send — 発行した請求書をメールで送る。
 * 外部に出す操作なので、既定は必ず dry-run(文面を見せるだけ)。
 * 実際に送るのは --yes を付けたときか、対話で「送る」と答えたときだけ。
 */
import fs from "node:fs";
import * as p from "@clack/prompts";
import type { Config, MailConfig } from "../core/types.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { findEntry, markEmailed, readLedger } from "../core/ledger.js";
import { findClient, saveClient } from "../core/store.js";
import { buildMailBody, ejectMailTemplate } from "../mail/body.js";
import { checkMailReady, sendMail } from "../mail/index.js";
import { mask, readEnv, writeEnv } from "../core/env.js";
import { envPath } from "../core/paths.js";
import * as ui from "../core/ui.js";

export interface SendArgs {
  _: string[];
  to?: string;
  no?: string;
  pdf?: string;
  bcc?: string;
  setup?: boolean;
  "eject-template"?: boolean;
  "no-attachment"?: boolean;
  yes?: boolean;
}

function cancelled(): never {
  p.cancel("中止しました。メールは送っていません。");
  process.exit(130);
}

/** メール送信の設定ウィザード */
async function setup(): Promise<number> {
  ui.requireInteractive("メール送信の設定");
  const config = loadConfig();
  p.intro(ui.c.bgCyan(ui.c.black(" メール送信の設定 ")));

  const provider = await p.select({
    message: "どちらで送りますか？",
    options: [
      {
        value: "resend",
        label: "Resend（推奨）",
        hint: "APIキーだけで始められる。独自ドメインを検証すれば自分のアドレスから送れる",
      },
      {
        value: "smtp",
        label: "SMTP",
        hint: "Gmailのアプリパスワードやレンタルサーバーのメールをそのまま使う",
      },
    ],
    initialValue: config.mail?.provider ?? "resend",
  });
  if (p.isCancel(provider)) cancelled();

  const fromName = await p.text({
    message: "差出人の表示名は？",
    initialValue: config.mail?.fromName ?? config.issuer.name,
    validate: (v) => (v.trim() ? undefined : "入力してください"),
  });
  if (p.isCancel(fromName)) cancelled();

  const fromEmail = await p.text({
    message: "差出人のメールアドレスは？",
    initialValue: config.mail?.fromEmail ?? config.issuer.email ?? "",
    validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? undefined : "メールアドレスの形式で入力してください"),
  });
  if (p.isCancel(fromEmail)) cancelled();

  const bcc = await p.text({
    message: "自分への控え（BCC）を送るアドレスは？（不要なら空欄）",
    initialValue: config.mail?.bcc ?? "",
  });
  if (p.isCancel(bcc)) cancelled();

  const mail: MailConfig = {
    provider: provider as "resend" | "smtp",
    fromName: String(fromName).trim(),
    fromEmail: String(fromEmail).trim(),
    ...(String(bcc).trim() ? { bcc: String(bcc).trim() } : {}),
  };

  if (provider === "resend") {
    p.note(
      [
        "1. https://resend.com にサインアップ（無料枠: 3,000通/月・100通/日）",
        "2. 自分のドメインを追加して DNS を設定（自分のアドレスから送るために必要）",
        "3. API Keys から キーを作成して、下に貼り付けてください",
        "",
        "※ ドメイン未検証のうちは onboarding@resend.dev からの",
        "   テスト送信（自分宛て）だけができます。",
      ].join("\n"),
      "Resend の準備",
    );
    const key = await p.password({
      message: `Resend の API キーは？（現在: ${mask(readEnv()["RESEND_API_KEY"])}）`,
    });
    if (p.isCancel(key)) cancelled();
    if (String(key).trim()) writeEnv({ RESEND_API_KEY: String(key).trim() });
  } else {
    const host = await p.text({
      message: "SMTPサーバーは？",
      placeholder: "smtp.gmail.com",
      initialValue: config.mail?.smtp?.host ?? "",
      validate: (v) => (v.trim() ? undefined : "入力してください"),
    });
    if (p.isCancel(host)) cancelled();
    const port = await p.select({
      message: "ポートは？",
      options: [
        { value: "587", label: "587（STARTTLS・一般的）" },
        { value: "465", label: "465（SSL）" },
      ],
      initialValue: String(config.mail?.smtp?.port ?? 587),
    });
    if (p.isCancel(port)) cancelled();
    const user = await p.text({
      message: "ログインユーザー名は？",
      initialValue: readEnv()["SMTP_USER"] ?? String(fromEmail),
    });
    if (p.isCancel(user)) cancelled();
    const pass = await p.password({
      message: `パスワードは？（Gmailならアプリパスワード / 現在: ${mask(readEnv()["SMTP_PASS"])}）`,
    });
    if (p.isCancel(pass)) cancelled();

    mail.smtp = { host: String(host).trim(), port: Number(port), secure: Number(port) === 465 };
    const updates: Record<string, string> = { SMTP_USER: String(user).trim() };
    if (String(pass).trim()) updates["SMTP_PASS"] = String(pass).trim();
    writeEnv(updates);
  }

  config.mail = mail;
  saveConfig(config);

  const problem = checkMailReady(config);
  p.note(
    [
      `設定: ${ui.dim(envPath())}（このファイルは共有しないでください）`,
      problem ? ui.c.yellow(problem) : ui.c.green("送信の準備ができています"),
    ].join("\n"),
    "保存しました",
  );
  p.outro(
    [
      "まずは自分宛てに試してください:",
      `  ${ui.c.cyan(`seikyusho-kun send <取引先名> --to ${mail.fromEmail} --yes`)}`,
    ].join("\n"),
  );
  return 0;
}

export async function runSend(args: SendArgs): Promise<number> {
  if (args["eject-template"]) {
    const file = ejectMailTemplate();
    ui.ok(`メール文面のテンプレートを書き出しました: ${file}`);
    ui.info("1行目が件名、2行目以降が本文です。{client} {total} {due} などが差し込まれます");
    return 0;
  }
  if (args.setup) return setup();

  const config: Config = loadConfig();
  const problem = checkMailReady(config);
  if (problem) {
    ui.fail(problem);
    return 1;
  }

  // --- 送る対象を決める ---
  const clientArg = args._[0];
  const entry = args.no
    ? findEntry("", args.no)
    : clientArg
      ? findEntry(findClient(clientArg)?.name ?? clientArg)
      : readLedger()[0];

  if (!entry) {
    ui.fail(
      clientArg
        ? `「${clientArg}」の発行済み請求書が見つかりません`
        : "発行済みの請求書がありません。先に `seikyusho-kun new` で発行してください",
    );
    return 1;
  }

  const client = findClient(entry.client);
  const to = args.to ?? client?.email;
  if (!to) {
    ui.fail(
      `送り先のメールアドレスがわかりません。\n  --to で指定するか、\`seikyusho-kun clients add "${entry.client}"\` で登録してください`,
    );
    return 1;
  }

  const attachmentPath = args["no-attachment"]
    ? undefined
    : (args.pdf ?? entry.pdfPath);
  if (attachmentPath && !fs.existsSync(attachmentPath)) {
    ui.fail(`添付するPDFが見つかりません: ${attachmentPath}`);
    ui.info("--pdf でパスを指定するか、--no-attachment で添付なしにできます");
    return 1;
  }

  const body = buildMailBody(config, entry, client?.contact);
  const bcc = args.bcc ?? config.mail?.bcc;

  // --- ここまでが下書き。まず必ず見せる ---
  ui.heading("送信内容の確認");
  ui.kv([
    ["宛先", to],
    ["BCC", bcc ?? ui.dim("なし")],
    ["差出人", `${config.mail?.fromName} <${config.mail?.fromEmail}>`],
    ["件名", body.subject],
    ["添付", attachmentPath ? attachmentPath.split("/").pop() ?? "" : ui.dim("なし")],
    ["請求書", `${entry.invoiceNo} / ${entry.client} / ${ui.yen(entry.payable)}`],
  ]);
  console.log("");
  console.log(ui.dim("─".repeat(60)));
  console.log(body.text);
  console.log(ui.dim("─".repeat(60)));
  console.log("");

  if (entry.emailedAt) {
    ui.warn(
      `この請求書は ${entry.emailedAt.slice(0, 10)} に ${entry.emailedTo} へ送信済みです`,
    );
  }

  // --- 送るかどうか ---
  let go = Boolean(args.yes);
  if (!go) {
    if (!ui.isInteractive()) {
      ui.info("確認だけしました。実際に送るには --yes を付けてください。");
      return 0;
    }
    const answer = await p.confirm({
      message: `この内容で ${to} に送信しますか？`,
      initialValue: false,
    });
    if (p.isCancel(answer)) cancelled();
    go = answer;
  }
  if (!go) {
    ui.info("送信しませんでした。");
    return 0;
  }

  const spin = ui.isInteractive() ? p.spinner() : null;
  spin?.start("送信しています");
  const result = await sendMail(config, {
    to,
    ...(bcc ? { bcc } : {}),
    subject: body.subject,
    text: body.text,
    ...(attachmentPath ? { attachmentPath } : {}),
    fromName: config.mail?.fromName ?? config.issuer.name,
    fromEmail: config.mail?.fromEmail as string,
  });
  spin?.stop(result.ok ? "送信しました" : "送信できませんでした");

  if (!result.ok) {
    ui.fail(result.error ?? "原因不明のエラー");
    return 1;
  }

  markEmailed(entry.invoiceNo, to);
  // 宛先を取引先に覚えておく(次回は --to が要らなくなる)
  if (client && !client.email && !args.to) {
    saveClient({ ...client, email: to });
  }
  ui.ok(`送信しました: ${to}${bcc ? `（BCC: ${bcc}）` : ""}`);
  return 0;
}
