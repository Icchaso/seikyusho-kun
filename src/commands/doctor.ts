/**
 * doctor — 動く状態かを実際に試して確かめる。
 * 「設定が書いてある」ではなく「PDFが1枚出せる」まで見る。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromeInfo } from "../core/chrome.js";
import { configExists, loadConfig, resolveOutputDir } from "../core/config.js";
import { buildPdf } from "../core/autofit.js";
import { pdfPageCount } from "../core/pdf.js";
import { resolveTheme } from "../core/render.js";
import { sampleDoc } from "../core/sample.js";
import { clientsDir, configPath, homeDir } from "../core/paths.js";
import { listClients } from "../core/store.js";
import * as ui from "../core/ui.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

function line(c: Check): void {
  const mark = c.ok ? ui.c.green("✔") : ui.c.red("✖");
  console.log(`${mark} ${c.name}  ${ui.dim(c.detail)}`);
  if (!c.ok && c.hint) console.log(`  ${ui.c.yellow("→")} ${c.hint}`);
}

export async function runDoctor(): Promise<number> {
  ui.heading("請求書くん 動作チェック");
  const checks: Check[] = [];

  // 1. Chrome
  const chrome = chromeInfo();
  checks.push({
    name: "PDF生成エンジン (Chrome)",
    ok: Boolean(chrome),
    detail: chrome ? `${chrome.version}` : "見つかりません",
    hint: "Google Chrome を入れるか、環境変数 SEIKYUSHO_CHROME で場所を指定してください",
  });

  // 2. 設定
  const hasConfig = configExists();
  checks.push({
    name: "設定ファイル",
    ok: hasConfig,
    detail: hasConfig ? configPath() : "未作成",
    hint: "`seikyusho-kun init` を実行してください",
  });

  if (!hasConfig || !chrome) {
    checks.forEach(line);
    console.log("");
    ui.fail("先に上の項目を解決してください。");
    return 1;
  }

  const config = loadConfig();

  // 3. 発行者情報
  checks.push({
    name: "発行者情報",
    ok: Boolean(config.issuer.name),
    detail: config.issuer.name
      ? `${config.issuer.name}${config.issuer.regNo ? ` / 登録番号 ${config.issuer.regNo}` : " / 登録番号なし（免税事業者）"}`
      : "屋号が未設定",
    hint: "`seikyusho-kun init` で屋号を入力してください",
  });

  // 4. テーマ
  let themeOk = true;
  let themeDetail = "";
  try {
    const t = resolveTheme(config.theme);
    themeDetail = t.builtin ? `${t.name}（内蔵）` : `${t.name}（自作）`;
  } catch (e) {
    themeOk = false;
    themeDetail = (e as Error).message.split("\n")[0] ?? "解決できません";
  }
  checks.push({
    name: "テーマ",
    ok: themeOk,
    detail: themeDetail,
    hint: "`seikyusho-kun theme list` で使えるテーマを確認してください",
  });

  // 5. 出力先に書けるか
  const outDir = resolveOutputDir(config, new Date());
  let writable = true;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const probe = path.join(outDir, `.seikyusho-write-test-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch {
    writable = false;
  }
  checks.push({
    name: "出力先フォルダ",
    ok: writable,
    detail: outDir,
    hint: "書き込み権限のあるフォルダを config.json の outputDir に設定してください",
  });

  // 6. 実際に1枚出してみる(ここが本番)
  let renderOk = false;
  let renderDetail = "";
  if (themeOk) {
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "seikyusho-doctor-")),
      "sample.pdf",
    );
    try {
      const doc = sampleDoc(config);
      const fit = buildPdf(doc, config, tmp);
      const pages = pdfPageCount(tmp);
      renderOk = pages >= 1 && fs.statSync(tmp).size > 1000;
      renderDetail = `サンプル請求書を生成 → A4 ${pages}ページ（密度 ${fit.density}, ${Math.round(fs.statSync(tmp).size / 1024)}KB）`;
    } catch (e) {
      renderDetail = (e as Error).message.split("\n")[0] ?? "失敗";
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }
  checks.push({
    name: "PDF生成テスト",
    ok: renderOk,
    detail: renderDetail,
    hint: "上のエラー内容を確認してください",
  });

  // 7. データ
  const clients = listClients();
  checks.push({
    name: "取引先データ",
    ok: true,
    detail: `${clients.length}件（${clientsDir()}）`,
  });

  // 8. メール設定(任意)
  const mail = config.mail;
  console.log("");
  checks.forEach(line);

  console.log("");
  ui.heading("任意の機能");
  console.log(
    `${mail ? ui.c.green("✔") : ui.dim("－")} メール送信  ${ui.dim(
      mail ? `${mail.provider}（${mail.fromEmail ?? "差出人未設定"}）` : "未設定（`seikyusho-kun send --setup` で設定できます）",
    )}`,
  );
  const scheduled = clients.filter((c) => c.schedule);
  console.log(
    `${scheduled.length ? ui.c.green("✔") : ui.dim("－")} 定期発行    ${ui.dim(
      scheduled.length
        ? `${scheduled.length}件の取引先に設定あり`
        : "未設定（`seikyusho-kun schedule add` で設定できます）",
    )}`,
  );
  if (config.hooks?.afterIssue) {
    console.log(`${ui.c.green("✔")} 発行後フック  ${ui.dim(config.hooks.afterIssue)}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("");
  if (failed.length === 0) {
    ui.ok(`すべて問題ありません。データの置き場所: ${homeDir()}`);
    return 0;
  }
  ui.fail(`${failed.length}件の問題があります。`);
  return 1;
}
