/** 画面出力の共通部品。CLI の見た目もプロダクトの一部として揃える */
import pc from "picocolors";

export const c = pc;

export function ok(msg: string): void {
  console.log(`${pc.green("✔")} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${pc.cyan("›")} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${pc.yellow("!")} ${msg}`);
}

export function fail(msg: string): void {
  console.error(`${pc.red("✖")} ${msg}`);
}

export function dim(msg: string): string {
  return pc.dim(msg);
}

export function heading(msg: string): void {
  console.log(`\n${pc.bold(msg)}`);
}

/** キーと値を桁揃えして並べる */
export function kv(rows: [string, string][], indent = "  "): void {
  const width = Math.max(...rows.map(([k]) => displayWidth(k)));
  for (const [k, v] of rows) {
    const pad = " ".repeat(Math.max(0, width - displayWidth(k)));
    console.log(`${indent}${pc.dim(k)}${pad}  ${v}`);
  }
}

/** 全角を2、半角を1として数える(日本語のラベルを揃えるため) */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[　-鿿！-｠゠-ヿ]/.test(ch) ? 2 : 1;
  }
  return w;
}

export function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/** 対話プロンプトを出してよい状況か(パイプ・cron 実行では出さない) */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * 対話が必要なコマンドを、パイプ・cron・AIエージェント経由で呼ばれたときに
 * 半端な状態で始めないためのガード。
 */
export function requireInteractive(what: string): void {
  if (isInteractive()) return;
  throw new Error(
    [
      `${what}はターミナルでの対話が必要です。`,
      "",
      "  ターミナルを開いて、そこで直接実行してください。",
      "  （パイプ・cron・エージェント経由では入力を受け取れません）",
    ].join("\n"),
  );
}
