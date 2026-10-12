/** 設定の読み書き。初回は init ウィザードが作る */
import fs from "node:fs";
import path from "node:path";
import type { Config, DocKind, QuoteConfig } from "./types.js";
import { configPath, ensureDir, expandTilde, homeDir } from "./paths.js";

export const CONFIG_VERSION = 1;

export function defaultQuoteConfig(): QuoteConfig {
  return {
    noPattern: "Q{yyyy}{mm}-{seq:3}",
    outputDir: "~/Documents/見積書/{year}",
    fileNamePattern: "見積書_{client}_{no}",
    greeting: "下記の通りお見積り申し上げます。",
    notes: ["本見積書の有効期限内にご発注いただいた場合の金額です。"],
    validFor: "1ヶ月後",
    expenseLabel: "諸経費",
    expenseNote: "交通費・駐車場代・ロケ地使用料ほか",
    revisions: "",
    deliveryFormat: "",
  };
}

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    issuer: { name: "" },
    bank: {},
    tax: {
      mode: "exclusive",
      defaultRate: 10,
      rounding: "floor",
      withholding: false,
    },
    theme: "plain",
    accentColor: "#2f6fb2",
    outputDir: "~/Documents/請求書/{year}",
    fileNamePattern: "請求書_{client}_{no}",
    invoiceNoPattern: "{yyyy}{mm}-{seq:3}",
    minRows: 5,
    greeting: "下記の通りご請求申し上げます。",
    notes: [
      "お振込手数料は貴社にてご負担いただきますようお願いいたします。",
    ],
    quote: defaultQuoteConfig(),
  };
}

export function configExists(): boolean {
  return fs.existsSync(configPath());
}

export function loadConfig(): Config {
  const p = configPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      "設定がまだありません。先に `seikyusho-kun init` を実行してください。",
    );
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<Config>;
  return mergeConfig(defaultConfig(), raw);
}

/** 設定ファイルに無いキーは既定値で埋める(バージョンアップで壊れないように) */
export function mergeConfig(base: Config, raw: Partial<Config>): Config {
  return {
    ...base,
    ...raw,
    issuer: { ...base.issuer, ...raw.issuer },
    bank: { ...base.bank, ...raw.bank },
    tax: { ...base.tax, ...raw.tax },
    notes: raw.notes ?? base.notes,
    quote: { ...base.quote, ...raw.quote },
    ...(raw.mail ? { mail: raw.mail } : {}),
    ...(raw.hooks ? { hooks: raw.hooks } : {}),
  };
}

export function saveConfig(config: Config): string {
  ensureDir(homeDir());
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return p;
}

/** 出力先ディレクトリ。{year}/{month} を展開する(見積書は別フォルダ) */
export function resolveOutputDir(
  config: Config,
  date: Date,
  kind: DocKind = "invoice",
): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const pattern = kind === "quote" ? config.quote.outputDir : config.outputDir;
  const dir = expandTilde(
    pattern.replace(/\{year\}/g, year).replace(/\{month\}/g, month),
  );
  return path.resolve(dir);
}
