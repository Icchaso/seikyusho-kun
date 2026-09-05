/**
 * init — セットアップウィザード。
 * ここで答えた内容が、そのまま自分の請求書テンプレートになる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as p from "@clack/prompts";
import type { Config, Rounding, TaxMode, TaxRate } from "../core/types.js";
import {
  configExists,
  defaultConfig,
  loadConfig,
  saveConfig,
} from "../core/config.js";
import { bundledSkillsDir, configPath, ensureDir, homeDir } from "../core/paths.js";
import { BUILTIN_THEMES } from "../core/render.js";
import { findChrome } from "../core/chrome.js";
import * as ui from "../core/ui.js";

function cancelled(): never {
  p.cancel("セットアップを中止しました。");
  process.exit(130);
}

async function text(
  message: string,
  opts: { placeholder?: string; initial?: string; required?: boolean } = {},
): Promise<string> {
  const r = await p.text({
    message,
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
    ...(opts.initial ? { initialValue: opts.initial } : {}),
    ...(opts.required
      ? { validate: (v: string) => (v.trim() ? undefined : "入力してください") }
      : {}),
  });
  if (p.isCancel(r)) cancelled();
  return String(r ?? "").trim();
}

/** Claude Code のスキルを ~/.claude/skills/ に入れる */
export function installClaudeSkill(): string | null {
  const src = path.join(bundledSkillsDir(), "seikyusho-kun");
  if (!fs.existsSync(src)) return null;
  const dest = path.join(os.homedir(), ".claude", "skills", "seikyusho-kun");
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

export async function runInit(args: { force?: boolean } = {}): Promise<number> {
  p.intro(ui.c.bgCyan(ui.c.black(" 請求書くん セットアップ ")));

  const existing = configExists();
  if (existing && !args.force) {
    const again = await p.confirm({
      message: "すでに設定があります。もう一度作り直しますか？（今の内容が初期値になります）",
      initialValue: false,
    });
    if (p.isCancel(again)) cancelled();
    if (!again) {
      p.outro(`設定はそのままです: ${configPath()}`);
      return 0;
    }
  }

  const base: Config = existing ? loadConfig() : defaultConfig();

  p.note(
    [
      "ここで答えた内容が、あなたの請求書の「発行元」欄になります。",
      "あとから " + ui.c.cyan("seikyusho-kun init") + " でいつでも変更できます。",
    ].join("\n"),
    "はじめに",
  );

  // --- 発行者 ---
  const name = await text("屋号 / 会社名は？", {
    placeholder: "サンプル工房",
    initial: base.issuer.name,
    required: true,
  });
  const rep = await text("代表者名は？（省略可）", {
    placeholder: "山田 太郎",
    initial: base.issuer.rep ?? "",
  });
  const regNo = await text("インボイス登録番号は？（未登録なら空欄のまま Enter）", {
    placeholder: "T1234567890123",
    initial: base.issuer.regNo ?? "",
  });
  const tel = await text("電話番号は？（省略可）", {
    placeholder: "03-1234-5678",
    initial: base.issuer.tel ?? "",
  });
  const email = await text("メールアドレスは？（省略可）", {
    placeholder: "info@example.com",
    initial: base.issuer.email ?? "",
  });
  const zip = await text("郵便番号は？（省略可）", {
    placeholder: "123-4567",
    initial: base.issuer.zip ?? "",
  });
  const address = await text("住所は？（省略可）", {
    placeholder: "東京都千代田区丸の内1-1-1",
    initial: base.issuer.address ?? "",
  });

  // --- 振込先 ---
  p.note("請求書の下部に載る振込先です。空欄にすると振込先の欄ごと消えます。", "お振込先");
  const bank = await text("銀行名は？", { placeholder: "サンプル銀行", initial: base.bank.bank ?? "" });
  const branch = bank ? await text("支店名は？", { placeholder: "丸の内支店", initial: base.bank.branch ?? "" }) : "";
  const branchCode = bank ? await text("支店番号は？（省略可）", { placeholder: "001", initial: base.bank.branchCode ?? "" }) : "";
  let accountType = base.bank.accountType ?? "普通";
  if (bank) {
    const t = await p.select({
      message: "口座種別は？",
      options: [
        { value: "普通", label: "普通" },
        { value: "当座", label: "当座" },
      ],
      initialValue: accountType,
    });
    if (p.isCancel(t)) cancelled();
    accountType = String(t);
  }
  const accountNumber = bank ? await text("口座番号は？", { placeholder: "1234567", initial: base.bank.accountNumber ?? "" }) : "";
  const accountHolder = bank ? await text("口座名義は？（カタカナ）", { placeholder: "ヤマダ タロウ", initial: base.bank.accountHolder ?? "" }) : "";

  // --- 消費税 ---
  const mode = await p.select({
    message: "金額の入れ方はどちらにしますか？",
    options: [
      { value: "exclusive", label: "税抜で入力する（外税）", hint: "一般的" },
      { value: "inclusive", label: "税込で入力する（内税）" },
    ],
    initialValue: base.tax.mode,
  });
  if (p.isCancel(mode)) cancelled();

  const withholding = await p.confirm({
    message: "源泉徴収を計算しますか？（個人事業主で報酬から天引きされる方向け）",
    initialValue: base.tax.withholding,
  });
  if (p.isCancel(withholding)) cancelled();

  // --- 見た目 ---
  const theme = await p.select({
    message: "請求書のデザインは？",
    options: [
      { value: "plain", label: "plain（既定）", hint: "白地・罫線のみ。どこに出しても浮かない" },
      { value: "modern", label: "modern", hint: "ロゴと色でブランドを出す" },
      { value: "compact", label: "compact", hint: "明細が多い人向け。余白を詰める" },
    ],
    initialValue: BUILTIN_THEMES.includes(base.theme as never) ? base.theme : "plain",
  });
  if (p.isCancel(theme)) cancelled();

  let logo = base.issuer.logo ?? "";
  let accentColor = base.accentColor;
  if (theme === "modern") {
    logo = await text("ロゴ画像のパスは？（省略可 / PNG・JPG・SVG）", {
      placeholder: "~/Pictures/logo.png",
      initial: logo,
    });
    accentColor = (await text("メインカラーは？（16進カラーコード）", {
      placeholder: "#2f6fb2",
      initial: accentColor,
    })) || accentColor;
  }

  // --- 出力先 ---
  const outputDir = await text("PDFの保存先フォルダは？", {
    placeholder: "~/Documents/請求書/{year}",
    initial: base.outputDir,
  });

  const config: Config = {
    ...base,
    issuer: {
      name,
      ...(rep ? { rep } : {}),
      ...(regNo ? { regNo } : {}),
      ...(tel ? { tel } : {}),
      ...(email ? { email } : {}),
      ...(zip ? { zip } : {}),
      ...(address ? { address } : {}),
      ...(logo ? { logo } : {}),
    },
    bank: {
      ...(bank ? { bank } : {}),
      ...(branch ? { branch } : {}),
      ...(branchCode ? { branchCode } : {}),
      ...(bank ? { accountType } : {}),
      ...(accountNumber ? { accountNumber } : {}),
      ...(accountHolder ? { accountHolder } : {}),
    },
    tax: {
      mode: mode as TaxMode,
      defaultRate: base.tax.defaultRate as TaxRate,
      rounding: base.tax.rounding as Rounding,
      withholding: Boolean(withholding),
    },
    theme: String(theme),
    accentColor,
    outputDir: outputDir || base.outputDir,
  };

  ensureDir(homeDir());
  const saved = saveConfig(config);

  // --- Claude Code スキル ---
  const wantSkill = await p.confirm({
    message: "Claude Code から「◯◯さんに15万で請求書出して」と頼めるようにしますか？",
    initialValue: true,
  });
  if (p.isCancel(wantSkill)) cancelled();
  let skillPath: string | null = null;
  if (wantSkill) skillPath = installClaudeSkill();

  const lines = [`設定: ${saved}`];
  if (skillPath) lines.push(`Claude Code スキル: ${skillPath}`);
  if (!findChrome()) {
    lines.push("");
    lines.push(ui.c.yellow("PDFを作る Chrome が見つかりませんでした。"));
    lines.push("Google Chrome を入れるか、SEIKYUSHO_CHROME で場所を指定してください。");
  }
  p.note(lines.join("\n"), "保存しました");

  p.outro(
    [
      "さっそく1枚出してみましょう:",
      "",
      `  ${ui.c.cyan("seikyusho-kun new")}`,
      "",
      "コマンドを全部書くならこう:",
      `  ${ui.c.dim('seikyusho-kun new --to "株式会社ABC" --item "ホームページ制作費" --amount 150000 --due 月末')}`,
    ].join("\n"),
  );
  return 0;
}
