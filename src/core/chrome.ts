/**
 * PDF生成エンジン。
 * システムに入っている Chrome / Edge / Chromium を headless で叩く。
 * puppeteer を使わないので、インストールで 180MB の Chromium を落とさずに済む。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LINUX_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "microsoft-edge-stable",
  "microsoft-edge",
  "brave-browser",
];

const WIN_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function whichSync(cmd: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, [cmd], { encoding: "utf-8" });
  if (r.status === 0 && r.stdout.trim()) {
    return r.stdout.trim().split(/\r?\n/)[0] ?? null;
  }
  return null;
}

let cached: string | null | undefined;

/** Chrome 系ブラウザの実行ファイルを探す。見つからなければ null */
export function findChrome(): string | null {
  if (cached !== undefined) return cached;

  const fromEnv = process.env.SEIKYUSHO_CHROME || process.env.CHROME_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) {
    cached = fromEnv;
    return cached;
  }

  const candidates =
    process.platform === "darwin"
      ? MAC_CANDIDATES
      : process.platform === "win32"
        ? WIN_CANDIDATES
        : [];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cached = c;
      return cached;
    }
  }

  if (process.platform !== "win32") {
    for (const name of LINUX_CANDIDATES) {
      const found = whichSync(name);
      if (found) {
        cached = found;
        return cached;
      }
    }
  }

  cached = null;
  return null;
}

export class ChromeNotFoundError extends Error {
  constructor() {
    super(
      [
        "PDFを作るための Chrome が見つかりませんでした。",
        "",
        "  次のどれかで解決できます:",
        "   1. Google Chrome をインストールする (https://www.google.com/chrome/)",
        "   2. すでに別の場所にあるなら、環境変数で場所を教える:",
        "      export SEIKYUSHO_CHROME=\"/path/to/chrome\"",
        "",
        "  Microsoft Edge / Chromium / Brave でも動きます。",
      ].join("\n"),
    );
    this.name = "ChromeNotFoundError";
  }
}

function requireChrome(): string {
  const bin = findChrome();
  if (!bin) throw new ChromeNotFoundError();
  return bin;
}

function baseArgs(): string[] {
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-dev-shm-usage",
  ];
  // CI(root実行)では sandbox が使えないことがある
  if (process.platform === "linux" && process.getuid?.() === 0) {
    args.push("--no-sandbox");
  }
  return args;
}

function withTempHtml<T>(html: string, fn: (fileUrl: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seikyusho-"));
  const file = path.join(dir, "invoice.html");
  fs.writeFileSync(file, html, "utf-8");
  try {
    return fn(new URL(`file://${file}`).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** HTML を A4 PDF にする */
export function htmlToPdf(html: string, outPath: string): void {
  const bin = requireChrome();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  withTempHtml(html, (url) => {
    const r = spawnSync(
      bin,
      [
        ...baseArgs(),
        "--no-pdf-header-footer",
        `--print-to-pdf=${outPath}`,
        url,
      ],
      { encoding: "utf-8", timeout: 60_000 },
    );
    if (r.error) throw r.error;
    if (!fs.existsSync(outPath)) {
      throw new Error(
        `PDFの生成に失敗しました。\nChrome: ${bin}\n${r.stderr ?? ""}`,
      );
    }
  });
}

/**
 * HTML を Chrome に読ませ、ページ内で測った数値を回収する。
 * ページ側で window.__measure() の結果を <html data-measure="..."> に書いてもらい、
 * --dump-dom した出力からそれを取り出す。
 * 「CSSにこう書いたから大丈夫」ではなく実測で確かめるために使う。
 */
export function measureDom(html: string): Record<string, number> | null {
  const bin = requireChrome();
  return withTempHtml(html, (url) => {
    const r = spawnSync(
      bin,
      [...baseArgs(), "--virtual-time-budget=3000", "--dump-dom", url],
      { encoding: "utf-8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (r.error || !r.stdout) return null;
    const m = r.stdout.match(/data-measure="([^"]*)"/);
    if (!m?.[1]) return null;
    try {
      return JSON.parse(m[1].replace(/&quot;/g, '"')) as Record<string, number>;
    } catch {
      return null;
    }
  });
}

/** doctor 用: 見つかった Chrome とバージョン */
export function chromeInfo(): { path: string; version: string } | null {
  const bin = findChrome();
  if (!bin) return null;
  try {
    const version = execFileSync(bin, ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    return { path: bin, version };
  } catch {
    return { path: bin, version: "(バージョン取得に失敗)" };
  }
}
