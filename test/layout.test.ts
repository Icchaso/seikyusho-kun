/**
 * レイアウトのテスト。
 * 「CSSにこう書いたから大丈夫」ではなく、Chrome に読ませて実測した数値で
 * ヘッダー・フッター・明細表が崩れていないことを確かめる。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "seikyusho-test-"));
process.env.SEIKYUSHO_HOME = HOME;

const { buildPdf, guessDensity } = await import("../src/core/autofit.js");
const { measureDom, findChrome } = await import("../src/core/chrome.js");
const { defaultConfig } = await import("../src/core/config.js");
const { buildInvoiceDoc } = await import("../src/core/invoice.js");
const { renderHtml } = await import("../src/core/render.js");
const { pdfPageCount } = await import("../src/core/pdf.js");
const { sampleItems } = await import("../src/core/sample.js");
type Config = import("../src/core/types.js").Config;
type LineItem = import("../src/core/types.js").LineItem;

const CHROME = findChrome();
const skip = CHROME ? false : "Chrome が無いのでレイアウト検証をとばします";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    issuer: {
      name: "サンプル工房",
      rep: "見本 太郎",
      regNo: "T1234567890123",
      tel: "03-1234-5678",
      email: "info@example.com",
      zip: "100-0001",
      address: "東京都千代田区サンプル1-2-3 サンプルビル10F",
    },
    bank: {
      bank: "サンプル銀行",
      branch: "本店営業部",
      branchCode: "001",
      accountType: "普通",
      accountNumber: "1234567",
      accountHolder: "サンプルコウボウ",
    },
    outputDir: path.join(HOME, "out"),
    ...overrides,
  };
}

function doc(config: Config, items: LineItem[], clientName = "サンプル商事株式会社") {
  return buildInvoiceDoc({
    config,
    client: { name: clientName, contact: "見本 花子" },
    items,
    invoiceNo: "TEST-001",
    issueDate: new Date(2026, 8, 5),
    dueDate: new Date(2026, 8, 30),
  });
}

/** 実測して崩れの有無を判定する */
function checkLayout(config: Config, items: LineItem[], clientName?: string) {
  const d = doc(config, items, clientName);
  const density = guessDensity(items.length);
  const html = renderHtml({ ...d, density }, config, { measure: true });
  const m = measureDom(html);
  assert.ok(m, "レイアウトの実測に失敗しました");
  return m;
}

const CASES: { label: string; items: LineItem[]; onePage: boolean }[] = [
  { label: "明細1件", items: sampleItems(1), onePage: true },
  { label: "明細5件", items: sampleItems(5), onePage: true },
  { label: "明細12件", items: sampleItems(12), onePage: true },
  { label: "明細30件", items: sampleItems(30), onePage: false },
];

describe("レイアウト実測（plain）", { skip }, () => {
  const config = makeConfig();

  for (const c of CASES) {
    it(`${c.label}: 横に溢れず、ヘッダーが最上部・フッターが末尾にある`, () => {
      const m = checkLayout(config, c.items);

      // 横に溢れていない(はみ出しは印刷で切れる)
      assert.ok(
        (m.docScrollWidth ?? 0) <= (m.docClientWidth ?? 0) + 2,
        `横に溢れています: ${m.docScrollWidth} > ${m.docClientWidth}`,
      );

      // ヘッダーが最上部にある
      assert.ok((m.headerTop ?? 99) < 5, `ヘッダーが最上部にありません: ${m.headerTop}`);

      // フッターが本文の末尾にあり、はみ出していない
      assert.ok(
        (m.footerBottom ?? 0) <= (m.bodyHeight ?? 0) + 2,
        `フッターが本文からはみ出しています: ${m.footerBottom} > ${m.bodyHeight}`,
      );

      // 明細表とフッターが重なっていない
      assert.ok(
        (m.footerTop ?? 0) >= (m.itemsBottom ?? 0) - 1,
        `明細表とフッターが重なっています: footerTop=${m.footerTop} itemsBottom=${m.itemsBottom}`,
      );

      // 合計欄と明細表が重なっていない
      assert.ok(
        (m.grandBottom ?? 0) <= (m.itemsTop ?? Infinity) + 1,
        `合計欄と明細表が重なっています: grandBottom=${m.grandBottom} itemsTop=${m.itemsTop}`,
      );
    });
  }

  it("長い社名・長い品名・9桁の金額でも横に溢れない", () => {
    const longName = "非常に長い名前の一般社団法人サンプル総合研究開発機構関西支部";
    const items: LineItem[] = [
      {
        name: "ホームページ制作費（トップページ・下層10ページ・問い合わせフォーム・CMS導入含む一式）",
        note: "ヒアリング2回、デザイン案3種、コーディング、公開後1ヶ月の軽微な修正対応を含みます。",
        qty: 1,
        unit: "式",
        amount: 987_654_321,
      },
    ];
    const m = checkLayout(makeConfig(), items, longName);
    assert.ok(
      (m.docScrollWidth ?? 0) <= (m.docClientWidth ?? 0) + 2,
      `横に溢れています: ${m.docScrollWidth} > ${m.docClientWidth}`,
    );
    assert.ok((m.footerBottom ?? 0) <= (m.bodyHeight ?? 0) + 2);
  });
});

describe("A4オートフィット（PDFのページ数を実測）", { skip }, () => {
  const config = makeConfig();
  const outDir = path.join(HOME, "pdf");
  before(() => fs.mkdirSync(outDir, { recursive: true }));

  for (const c of CASES) {
    it(`${c.label}: ${c.onePage ? "A4 1ページに収まる" : "複数ページになりページ番号が入る"}`, () => {
      const out = path.join(outDir, `${c.label}.pdf`);
      const fit = buildPdf(doc(config, c.items), config, out);
      const pages = pdfPageCount(out);
      assert.equal(fit.pages, pages, "戻り値のページ数と実測が一致しない");

      if (c.onePage) {
        assert.equal(pages, 1, `A4 1ページに収まりませんでした（${pages}ページ）`);
      } else {
        assert.ok(pages >= 2, "複数ページになるはずが1ページでした");
        assert.match(fit.html, /class="page n">1 \/ \d+</, "ページ番号が入っていません");
        assert.match(fit.html, /<thead>/, "明細のヘッダー行がありません");
      }
    });
  }
});

describe("テーマ切り替え", { skip }, () => {
  for (const theme of ["plain", "modern", "compact"]) {
    it(`${theme}: PDFが1ページで生成できる`, () => {
      const config = makeConfig({ theme });
      const out = path.join(HOME, `theme-${theme}.pdf`);
      const fit = buildPdf(doc(config, sampleItems(3)), config, out);
      assert.equal(fit.pages, 1);
      assert.ok(fs.statSync(out).size > 1000, "PDFが小さすぎます");
    });
  }
});

after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});
