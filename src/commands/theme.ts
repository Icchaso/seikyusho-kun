/**
 * theme — 見た目の切り替えと、自作テンプレートへの持ち出し。
 * 既定の plain で使い始めて、望む人だけ自分のものにできる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig } from "../core/config.js";
import {
  BUILTIN_THEMES,
  isBuiltinTheme,
  resolveTheme,
} from "../core/render.js";
import { buildPdf } from "../core/autofit.js";
import { sampleDoc } from "../core/sample.js";
import { bundledTemplatesDir, ensureDir, templatesDir } from "../core/paths.js";
import * as ui from "../core/ui.js";

function userThemes(): string[] {
  const dir = templatesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function openFile(file: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(cmd, [file], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  }).unref();
}

function listThemes(): number {
  const config = loadConfig();
  ui.heading("使えるテーマ");
  const rows: [string, string][] = [];
  for (const t of BUILTIN_THEMES) {
    const mark = config.theme === t ? ui.c.green(" ← 使用中") : "";
    const desc =
      t === "plain"
        ? "白地・罫線のみ。どこに出しても浮かない既定のデザイン"
        : t === "modern"
          ? "ロゴとメインカラーでブランドを出す"
          : "明細が多い人向け。余白を詰めて行数を稼ぐ";
    rows.push([t, `${desc}${mark}`]);
  }
  const mine = userThemes();
  for (const t of mine) {
    const mark = config.theme === t ? ui.c.green(" ← 使用中") : "";
    rows.push([t, `自作テーマ（${path.join(templatesDir(), t)}）${mark}`]);
  }
  ui.kv(rows);
  console.log("");
  ui.info(`切り替え: ${ui.c.cyan("seikyusho-kun theme use <名前>")}`);
  ui.info(`見比べる: ${ui.c.cyan("seikyusho-kun theme preview")}`);
  ui.info(`自分で作る: ${ui.c.cyan("seikyusho-kun theme eject plain")}`);
  return 0;
}

function useTheme(name: string): number {
  const config = loadConfig();
  resolveTheme(name); // 存在しなければここで例外
  config.theme = name;
  saveConfig(config);
  ui.ok(`テーマを「${name}」に切り替えました`);
  return 0;
}

function previewThemes(name: string | undefined, outDir?: string): number {
  const config = loadConfig();
  const targets = name ? [name] : [...BUILTIN_THEMES, ...userThemes()];
  const dir = outDir
    ? ensureDir(path.resolve(outDir))
    : fs.mkdtempSync(path.join(os.tmpdir(), "seikyusho-preview-"));

  const made: string[] = [];
  for (const t of targets) {
    const themed = { ...config, theme: t };
    resolveTheme(t);
    const doc = sampleDoc(themed);
    const out = path.join(dir, `preview_${t}.pdf`);
    const fit = buildPdf(doc, themed, out);
    made.push(out);
    ui.ok(`${t.padEnd(8)} → ${out} ${ui.dim(`(A4 ${fit.pages}ページ / 密度 ${fit.density})`)}`);
  }
  const first = made[0];
  if (first) openFile(first);
  console.log("");
  ui.info("気に入ったものを `seikyusho-kun theme use <名前>` で選んでください");
  return 0;
}

/** 内蔵テンプレートを自分のフォルダへ書き出して、自由に編集できるようにする */
function ejectTheme(from: string, as?: string): number {
  const source = from || "plain";
  if (!isBuiltinTheme(source)) {
    throw new Error(
      `書き出せるのは内蔵テーマだけです: ${BUILTIN_THEMES.join(" / ")}`,
    );
  }
  const name = as || "mine";
  const dest = path.join(templatesDir(), name);
  if (fs.existsSync(dest)) {
    throw new Error(
      `すでに ${dest} があります。別の名前を --as で指定してください。`,
    );
  }
  ensureDir(dest);

  const bundled = bundledTemplatesDir();
  fs.copyFileSync(
    path.join(bundled, "invoice.njk"),
    path.join(dest, "invoice.njk"),
  );
  // base.css と テーマCSS をひとつにまとめて、1ファイルだけ触ればいい状態にする
  const css = [
    "/* ============================================================",
    `   ${name} — ${source} から書き出した自作テーマ`,
    "   このファイルを編集すると請求書の見た目が変わります。",
    "   構造そのものを変えたいときは invoice.njk を編集してください。",
    "   ============================================================ */",
    "",
    fs.readFileSync(path.join(bundled, "themes", `${source}.css`), "utf-8"),
  ].join("\n");
  fs.writeFileSync(path.join(dest, "theme.css"), css, "utf-8");
  // 参考用に共通の骨格CSSも置く(読み取り専用のつもりで)
  fs.copyFileSync(
    path.join(bundled, "base.css"),
    path.join(dest, "base.reference.css"),
  );

  ui.ok(`テンプレートを書き出しました: ${dest}`);
  ui.kv([
    ["theme.css", "見た目（色・線・余白）を編集するファイル"],
    ["invoice.njk", "構造そのものを変えたいとき"],
    ["base.reference.css", "共通の骨格（読むだけ。編集は theme.css で上書き）"],
  ]);
  console.log("");
  ui.info(`使うには: ${ui.c.cyan(`seikyusho-kun theme use ${name}`)}`);
  ui.info(
    `手元の請求書に寄せたいときは、Claude Code に「${dest} を私の請求書に合わせて」と頼むのが早いです`,
  );
  return 0;
}

export interface ThemeArgs {
  _: string[];
  as?: string;
  out?: string;
}

export async function runTheme(args: ThemeArgs): Promise<number> {
  const [sub, arg] = args._;
  switch (sub) {
    case undefined:
    case "list":
      return listThemes();
    case "use":
      if (!arg) throw new Error("テーマ名を指定してください（例: theme use modern）");
      return useTheme(arg);
    case "preview":
      return previewThemes(arg, args.out);
    case "eject":
      return ejectTheme(arg ?? "plain", args.as);
    default:
      throw new Error(
        `theme のサブコマンドは list / use / preview / eject です（受け取った値: ${sub}）`,
      );
  }
}
