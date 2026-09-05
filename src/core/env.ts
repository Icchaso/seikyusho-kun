/**
 * ~/.seikyusho-kun/.env の読み書き。
 * APIキーやSMTPパスワードはここだけに置き、設定ファイルにもリポジトリにも入れない。
 */
import fs from "node:fs";
import { ensureDir, envPath, homeDir } from "./paths.js";

export type Env = Record<string, string>;

export function readEnv(): Env {
  const p = envPath();
  if (!fs.existsSync(p)) return {};
  const env: Env = {};
  for (const raw of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** 既存の内容を保ったままキーを更新する。ファイルは本人だけが読める権限にする */
export function writeEnv(updates: Env): string {
  ensureDir(homeDir());
  const merged = { ...readEnv(), ...updates };
  const body =
    [
      "# 請求書くん の認証情報",
      "# このファイルは絶対に共有・コミットしないでください",
      "",
      ...Object.entries(merged).map(([k, v]) => `${k}=${v}`),
    ].join("\n") + "\n";
  const p = envPath();
  fs.writeFileSync(p, body, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // Windows など chmod が効かない環境は黙って続行する
  }
  return p;
}

/** 環境変数 → .env の順で探す(CI や cron では環境変数が使える) */
export function getSecret(key: string): string | undefined {
  return process.env[key] || readEnv()[key];
}

/** 表示用に伏せる。先頭数文字だけ残す */
export function mask(value?: string): string {
  if (!value) return "(未設定)";
  if (value.length <= 8) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 6)}${"*".repeat(Math.min(12, value.length - 6))}`;
}
