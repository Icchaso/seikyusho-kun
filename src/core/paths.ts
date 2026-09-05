/** データの置き場所。リポジトリの外に置くので、公開物に個人データが混ざらない */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** ~/.seikyusho-kun (テスト時は SEIKYUSHO_HOME で差し替えられる) */
export function homeDir(): string {
  const override = process.env.SEIKYUSHO_HOME;
  if (override) return path.resolve(expandTilde(override));
  return path.join(os.homedir(), ".seikyusho-kun");
}

export const configPath = () => path.join(homeDir(), "config.json");
export const clientsDir = () => path.join(homeDir(), "clients");
export const templatesDir = () => path.join(homeDir(), "templates");
export const counterPath = () => path.join(homeDir(), "counter.json");
export const envPath = () => path.join(homeDir(), ".env");
export const logsDir = () => path.join(homeDir(), "logs");

/**
 * パッケージに同梱されたディレクトリを探す。
 * dist/core/ から上へ辿るので、ビルド先が dist でも dist-test でも見つかる。
 */
function findBundled(name: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `同梱の ${name}/ が見つかりません。パッケージが壊れている可能性があります。`,
  );
}

/** パッケージに同梱された templates/ の場所 */
export function bundledTemplatesDir(): string {
  return findBundled("templates");
}

/** パッケージに同梱された skills/ の場所 */
export function bundledSkillsDir(): string {
  return findBundled("skills");
}

export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** ファイル名に使えない文字を落とす */
export function safeFileName(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}
