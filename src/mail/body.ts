/** 請求メールの件名・本文づくり。テンプレートは差し替えできる */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../core/types.js";
import type { LedgerEntry } from "../core/ledger.js";
import { guessHonorific } from "../core/honorific.js";
import { templatesDir } from "../core/paths.js";

const DEFAULT_TEMPLATE = `【{issuer}】{year}年{month}月分 ご請求書の送付
{client} {honorific}
{contactLine}
平素より大変お世話になっております。
{issuer}{repSuffix}でございます。

{year}年{month}月分のご請求書をお送りいたします。
内容をご確認のうえ、お手続きくださいますようお願いいたします。

■ ご請求金額：{total}（税込）
■ お支払期限：{due}
■ 請求書番号：{invoiceNo}

ご不明な点がございましたら、本メールにご返信ください。
今後ともどうぞよろしくお願い申し上げます。

──────────────────────
{issuer}
{rep}{emailLine}{telLine}
──────────────────────`;

export interface MailBody {
  subject: string;
  text: string;
}

function jpDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** ~/.seikyusho-kun/templates/mail/invoice.txt があればそれを使う(1行目が件名) */
function loadTemplate(): string {
  const custom = path.join(templatesDir(), "mail", "invoice.txt");
  if (fs.existsSync(custom)) return fs.readFileSync(custom, "utf-8");
  return DEFAULT_TEMPLATE;
}

export function buildMailBody(
  config: Config,
  entry: LedgerEntry,
  contact?: string,
): MailBody {
  const [y, m] = entry.issueDate.split("-").map(Number);
  const vars: Record<string, string> = {
    client: entry.client,
    honorific: guessHonorific(entry.client),
    contactLine: contact ? `${contact} 様\n` : "",
    issuer: config.issuer.name,
    rep: config.issuer.rep ?? "",
    repSuffix: config.issuer.rep ? ` ${config.issuer.rep}` : "",
    emailLine: config.issuer.email ? `\n${config.issuer.email}` : "",
    telLine: config.issuer.tel ? `\nTEL: ${config.issuer.tel}` : "",
    total: `¥${entry.payable.toLocaleString("ja-JP")}`,
    totalGross: `¥${entry.total.toLocaleString("ja-JP")}`,
    due: jpDate(entry.dueDate),
    issueDate: jpDate(entry.issueDate),
    invoiceNo: entry.invoiceNo,
    year: String(y ?? ""),
    month: String(m ?? ""),
  };

  const filled = loadTemplate().replace(
    /\{(\w+)\}/g,
    (whole, key: string) => vars[key] ?? whole,
  );
  const [subject = "", ...rest] = filled.split("\n");
  return { subject: subject.trim(), text: rest.join("\n").trimStart() };
}

/** テンプレートを書き出して編集できるようにする */
export function ejectMailTemplate(): string {
  const dir = path.join(templatesDir(), "mail");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "invoice.txt");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, DEFAULT_TEMPLATE, "utf-8");
  }
  return file;
}
