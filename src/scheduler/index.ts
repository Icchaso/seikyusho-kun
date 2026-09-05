/**
 * 毎日決まった時刻に run-due を走らせる仕組みの登録・解除。
 * macOS は launchd、Linux は crontab、Windows は タスクスケジューラ を使う。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDir, logsDir } from "../core/paths.js";

export const LABEL = "com.seikyusho-kun.daily";
const CRON_MARKER = "# seikyusho-kun daily";

export interface ScheduleStatus {
  installed: boolean;
  platform: NodeJS.Platform;
  detail: string;
  /** 登録に使っているファイルやコマンド */
  location?: string;
}

/** インストールされた CLI の実体パス */
export function cliPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "cli.js");
}

function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function runDueCommand(): string[] {
  return [process.execPath, cliPath(), "run-due", "--yes"];
}

function logFile(): string {
  return path.join(ensureDir(logsDir()), "run-due.log");
}

/**
 * 自動実行に引き継ぐ環境変数。
 * launchd や cron は最小限の環境で走るため、いま効いている設定を焼き込んでおかないと
 * 「手で叩くと動くのに自動だと動かない」が起きる。
 */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.SEIKYUSHO_HOME) env["SEIKYUSHO_HOME"] = process.env.SEIKYUSHO_HOME;
  if (process.env.SEIKYUSHO_CHROME) env["SEIKYUSHO_CHROME"] = process.env.SEIKYUSHO_CHROME;
  // node や chrome を PATH から探すので、いまの PATH を引き継ぐ
  if (process.env.PATH) env["PATH"] = process.env.PATH;
  return env;
}

// ---------- macOS (launchd) ----------

function installDarwin(hour: number, minute: number): ScheduleStatus {
  const [node, cli, ...rest] = runDueCommand();
  const args = [node as string, cli as string, ...rest]
    .map((a) => `    <string>${a}</string>`)
    .join("\n");
  const envEntries = Object.entries(inheritedEnv())
    .map(([k, v]) => `    <key>${k}</key><string>${v}</string>`)
    .join("\n");
  const envBlock = envEntries
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envEntries}\n  </dict>\n`
    : "";

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${envBlock}  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${logFile()}</string>
  <key>StandardErrorPath</key>
  <string>${logFile()}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
  const p = launchAgentPath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, plist, "utf-8");
  spawnSync("launchctl", ["unload", p], { encoding: "utf-8" });
  const r = spawnSync("launchctl", ["load", p], { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`launchctl への登録に失敗しました:\n${r.stderr}`);
  }
  return {
    installed: true,
    platform: "darwin",
    detail: `毎日 ${hour}:${String(minute).padStart(2, "0")} に実行します`,
    location: p,
  };
}

function uninstallDarwin(): void {
  const p = launchAgentPath();
  if (fs.existsSync(p)) {
    spawnSync("launchctl", ["unload", p], { encoding: "utf-8" });
    fs.unlinkSync(p);
  }
}

// ---------- Linux (crontab) ----------

function readCrontab(): string {
  const r = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
  return r.status === 0 ? r.stdout : "";
}

function writeCrontab(content: string): void {
  const r = spawnSync("crontab", ["-"], { input: content, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`crontab の更新に失敗しました:\n${r.stderr}`);
}

function stripCronEntry(content: string): string {
  return content
    .split("\n")
    .filter((l) => !l.includes(CRON_MARKER))
    .join("\n");
}

function installLinux(hour: number, minute: number): ScheduleStatus {
  const cmd = runDueCommand()
    .map((a) => (a.includes(" ") ? `"${a}"` : a))
    .join(" ");
  const envPrefix = Object.entries(inheritedEnv())
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const line = `${minute} ${hour} * * * ${envPrefix} ${cmd} >> "${logFile()}" 2>&1 ${CRON_MARKER}`;
  const next = `${stripCronEntry(readCrontab()).trimEnd()}\n${line}\n`;
  writeCrontab(next.trimStart());
  return {
    installed: true,
    platform: "linux",
    detail: `毎日 ${hour}:${String(minute).padStart(2, "0")} に実行します`,
    location: "crontab",
  };
}

function uninstallLinux(): void {
  const current = readCrontab();
  if (current.includes(CRON_MARKER)) writeCrontab(stripCronEntry(current));
}

// ---------- Windows (schtasks) ----------

function installWin32(hour: number, minute: number): ScheduleStatus {
  const [node, cli, ...rest] = runDueCommand();
  // Windows のタスクスケジューラは環境変数を引き継がないので、cmd /c で先に設定する
  const envPrefix = Object.entries(inheritedEnv())
    .filter(([k]) => k !== "PATH")
    .map(([k, v]) => `set ${k}=${v} && `)
    .join("");
  const tr = envPrefix
    ? `cmd /c "${envPrefix}"${node}" "${cli}" ${rest.join(" ")}"`
    : `"${node}" "${cli}" ${rest.join(" ")}`;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const r = spawnSync(
    "schtasks",
    ["/Create", "/F", "/SC", "DAILY", "/ST", time, "/TN", LABEL, "/TR", tr],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`タスクスケジューラへの登録に失敗しました:\n${r.stderr || r.stdout}`);
  }
  return {
    installed: true,
    platform: "win32",
    detail: `毎日 ${time} に実行します`,
    location: `タスクスケジューラ: ${LABEL}`,
  };
}

function uninstallWin32(): void {
  spawnSync("schtasks", ["/Delete", "/F", "/TN", LABEL], { encoding: "utf-8" });
}

// ---------- 共通 ----------

export function installSchedule(hour = 9, minute = 0): ScheduleStatus {
  switch (process.platform) {
    case "darwin":
      return installDarwin(hour, minute);
    case "win32":
      return installWin32(hour, minute);
    default:
      return installLinux(hour, minute);
  }
}

export function uninstallSchedule(): void {
  switch (process.platform) {
    case "darwin":
      return uninstallDarwin();
    case "win32":
      return uninstallWin32();
    default:
      return uninstallLinux();
  }
}

export function scheduleStatus(): ScheduleStatus {
  if (process.platform === "darwin") {
    const p = launchAgentPath();
    const installed = fs.existsSync(p);
    return {
      installed,
      platform: "darwin",
      detail: installed ? "launchd に登録されています" : "未登録です",
      ...(installed ? { location: p } : {}),
    };
  }
  if (process.platform === "win32") {
    const r = spawnSync("schtasks", ["/Query", "/TN", LABEL], { encoding: "utf-8" });
    const installed = r.status === 0;
    return {
      installed,
      platform: "win32",
      detail: installed ? "タスクスケジューラに登録されています" : "未登録です",
      ...(installed ? { location: LABEL } : {}),
    };
  }
  const installed = readCrontab().includes(CRON_MARKER);
  return {
    installed,
    platform: process.platform,
    detail: installed ? "crontab に登録されています" : "未登録です",
    ...(installed ? { location: "crontab" } : {}),
  };
}
