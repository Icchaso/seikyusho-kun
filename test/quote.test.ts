/**
 * 見積書のテスト。
 * 「請求書の仕組みを流用している」ことで壊れやすいところ
 * （番号の混ざり、源泉徴収、振込先の出し分け、請求書への引き継ぎ）を押さえる。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "seikyusho-quote-test-"));
process.env.SEIKYUSHO_HOME = HOME;

const { defaultConfig } = await import("../src/core/config.js");
const { addMonths } = await import("../src/core/dates.js");
const { buildQuoteDoc, buildExpenseItem } = await import("../src/core/quote.js");
const { recordQuote, findQuote, markInvoiced, readQuotes } = await import(
  "../src/core/quote-ledger.js"
);
const { nextInvoiceNo, nextQuoteNo, counterScope } = await import(
  "../src/core/numbering.js"
);
const { renderHtml } = await import("../src/core/render.js");
const { buildPdf } = await import("../src/core/autofit.js");
const { pdfPageCount } = await import("../src/core/pdf.js");
const { findChrome } = await import("../src/core/chrome.js");
const { sampleQuoteDoc } = await import("../src/core/sample.js");
type Config = import("../src/core/types.js").Config;
type LineItem = import("../src/core/types.js").LineItem;

const ISSUE = new Date(2026, 9, 12); // 2026-10-12

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    issuer: { name: "サンプル工房", regNo: "T1234567890123" },
    bank: {
      bank: "サンプル銀行",
      accountNumber: "1234567",
      accountHolder: "サンプルコウボウ",
    },
    outputDir: path.join(HOME, "out"),
    ...overrides,
  };
}

const ITEMS: LineItem[] = [
  { name: "撮影一式", qty: 1, unit: "式", amount: 300000 },
  { name: "編集費", qty: 1, unit: "式", amount: 100000 },
];

function quoteDoc(config: Config, items: LineItem[] = ITEMS) {
  return buildQuoteDoc({
    config,
    client: { name: "株式会社ABC", contact: "山田 太郎" },
    items,
    quoteNo: "Q202610-001",
    issueDate: ISSUE,
    validUntil: addMonths(ISSUE, 1),
  });
}

describe("見積書番号", () => {
  it("請求書と同じパターンでも連番が混ざらない", () => {
    const pattern = "{yyyy}{mm}-{seq:3}";
    assert.equal(nextInvoiceNo(pattern, ISSUE), "202610-001");
    assert.equal(nextInvoiceNo(pattern, ISSUE), "202610-002");
    // 見積書は別の連番として1から始まる
    assert.equal(nextQuoteNo(pattern, ISSUE), "202610-001");
    assert.equal(nextQuoteNo(pattern, ISSUE), "202610-002");
    // 請求書側の連番は見積書の発行に影響されない
    assert.equal(nextInvoiceNo(pattern, ISSUE), "202610-003");
  });

  it("カウンタの区分が請求書と見積書で別になっている", () => {
    assert.equal(counterScope("{yyyy}{mm}-{seq:3}", ISSUE), "2026-10");
    assert.equal(
      counterScope("{yyyy}{mm}-{seq:3}", ISSUE, "quote"),
      "quote:2026-10",
    );
  });
});

describe("見積書の組み立て", () => {
  it("書類の種類が見積書になり、有効期限が入る", () => {
    const doc = quoteDoc(makeConfig());
    assert.equal(doc.kind, "quote");
    assert.equal(doc.terms?.validUntilISO, "2026-11-12");
    assert.equal(doc.terms?.validUntil, "2026年11月12日");
  });

  it("源泉徴収の設定がONでも見積書では引かない", () => {
    const config = makeConfig({
      tax: { ...defaultConfig().tax, withholding: true },
    });
    const doc = quoteDoc(config);
    assert.equal(doc.totals.withholding, undefined);
    assert.equal(doc.totals.payable, undefined);
    assert.equal(doc.totals.total, 440000); // 40万 + 消費税10%
  });

  it("挨拶文と備考が見積書用の既定になる", () => {
    const doc = quoteDoc(makeConfig());
    assert.equal(doc.greeting, "下記の通りお見積り申し上げます。");
    assert.ok(
      doc.notes.some((n) => n.includes("有効期限")),
      `見積書用の備考になっていません: ${JSON.stringify(doc.notes)}`,
    );
  });

  it("納期・納品形式・修正回数を渡すと条件欄に入る", () => {
    const doc = buildQuoteDoc({
      config: makeConfig(),
      client: { name: "株式会社ABC" },
      items: ITEMS,
      quoteNo: "Q202610-002",
      issueDate: ISSUE,
      validUntil: addMonths(ISSUE, 1),
      delivery: "ご発注後30日",
      deliveryFormat: "MP4 / H.264 / 1920×1080",
      revisions: "初稿提出後2回まで",
    });
    assert.equal(doc.terms?.delivery, "ご発注後30日");
    assert.equal(doc.terms?.deliveryFormat, "MP4 / H.264 / 1920×1080");
    assert.equal(doc.terms?.revisions, "初稿提出後2回まで");
  });

  it("設定の既定が納品形式・修正回数に使われる", () => {
    const config = makeConfig();
    config.quote.revisions = "初稿提出後2回まで";
    config.quote.deliveryFormat = "MP4";
    const doc = quoteDoc(config);
    assert.equal(doc.terms?.revisions, "初稿提出後2回まで");
    assert.equal(doc.terms?.deliveryFormat, "MP4");
  });
});

describe("諸経費の行", () => {
  const config = makeConfig();

  it("金額で指定できる", () => {
    const item = buildExpenseItem("30000", ITEMS, config);
    assert.equal(item.name, "諸経費");
    assert.equal(item.amount, 30000);
    assert.ok(item.note?.includes("交通費"));
  });

  it("「15万」のような言い方も通る", () => {
    assert.equal(buildExpenseItem("15万", ITEMS, config).amount, 150000);
  });

  it("率で指定すると他の明細の合計から計算する", () => {
    // 30万 + 10万 = 40万 の 10% = 4万
    assert.equal(buildExpenseItem("10%", ITEMS, config).amount, 40000);
    assert.equal(buildExpenseItem("７％", ITEMS, config).amount, 28000);
  });

  it("単価と数量だけの明細でも率が計算できる", () => {
    const items: LineItem[] = [{ name: "撮影", qty: 4, unitPrice: 50000 }];
    assert.equal(buildExpenseItem("10%", items, config).amount, 20000);
  });

  it("明細が無い状態で率を指定したら、理由の分かるエラーになる", () => {
    assert.throws(() => buildExpenseItem("10%", [], config), /明細/);
  });

  it("内訳の文を上書きできる", () => {
    const item = buildExpenseItem("1000", ITEMS, config, "駐車場代のみ");
    assert.equal(item.note, "駐車場代のみ");
  });
});

describe("見積台帳", () => {
  it("明細ごと記録され、番号で引き直せる", () => {
    const doc = quoteDoc(makeConfig());
    const client = { name: "株式会社ABC", contact: "山田 太郎" };
    recordQuote(doc, client, ITEMS, "/tmp/dummy.pdf", "plain");

    const found = findQuote("Q202610-001");
    assert.ok(found, "見積書を引けませんでした");
    assert.equal(found.client.name, "株式会社ABC");
    assert.equal(found.total, 440000);
    // 請求書へ渡すために、計算前の明細が残っている
    assert.deepEqual(found.items, ITEMS);
  });

  it("取引先名でも引ける", () => {
    const found = findQuote("ABC");
    assert.ok(found);
    assert.equal(found.quoteNo, "Q202610-001");
  });

  it("請求書に変換したら請求済みとして記録される", () => {
    markInvoiced("Q202610-001", "202610-009");
    const found = findQuote("Q202610-001");
    assert.equal(found?.invoicedNo, "202610-009");
    assert.ok(found?.invoicedAt);
  });

  it("同じ番号で出し直しても二重に増えない", () => {
    const doc = quoteDoc(makeConfig());
    const before = readQuotes().length;
    recordQuote(doc, { name: "株式会社ABC" }, ITEMS, "/tmp/dummy2.pdf", "plain");
    assert.equal(readQuotes().length, before);
  });

  it("無い番号を引いたら null を返す", () => {
    assert.equal(findQuote("Q999999-999"), null);
  });
});

describe("見積書の見た目", () => {
  const config = makeConfig();

  it("「見積書」として組まれ、振込先と源泉徴収は出ない", () => {
    const withholding = makeConfig({
      tax: { ...defaultConfig().tax, withholding: true },
    });
    const html = renderHtml(quoteDoc(withholding), withholding);
    assert.match(html, /<h1 class="hd-title">見積書<\/h1>/);
    assert.match(html, /見積書番号/);
    assert.match(html, /お見積金額/);
    assert.match(html, /有効期限/);
    assert.doesNotMatch(html, /サンプル銀行/, "見積書に振込先が出ています");
    assert.doesNotMatch(html, /源泉徴収/, "見積書に源泉徴収が出ています");
    assert.doesNotMatch(html, /お支払期限/);
  });

  it("請求書のほうは今までどおり振込先が出る", async () => {
    const { buildInvoiceDoc } = await import("../src/core/invoice.js");
    const doc = buildInvoiceDoc({
      config,
      client: { name: "株式会社ABC" },
      items: ITEMS,
      invoiceNo: "202610-001",
      issueDate: ISSUE,
      dueDate: addMonths(ISSUE, 1),
    });
    const html = renderHtml(doc, config);
    assert.match(html, /<h1 class="hd-title">請求書<\/h1>/);
    assert.match(html, /サンプル銀行/);
    assert.match(html, /お支払期限/);
  });

  it("条件欄は中身があるときだけ出る", () => {
    const bare = renderHtml(quoteDoc(config), config);
    assert.doesNotMatch(bare, /お見積条件/);

    const full = renderHtml(sampleQuoteDoc(config), config);
    assert.match(full, /お見積条件/);
    assert.match(full, /納品形式/);
    assert.match(full, /修正回数/);
  });
});

describe("見積書のPDF", { skip: findChrome() ? false : "Chrome が無いのでとばします" }, () => {
  it("A4 1ページで出る", () => {
    const config = makeConfig();
    const out = path.join(HOME, "quote.pdf");
    const fit = buildPdf(sampleQuoteDoc(config), config, out);
    assert.equal(fit.pages, 1, `1ページに収まりませんでした（${fit.pages}ページ）`);
    assert.equal(pdfPageCount(out), 1);
    assert.ok(fs.statSync(out).size > 1000, "PDFが小さすぎます");
  });

  it("見積書は見積書用のフォルダに出る", async () => {
    const { resolveOutputPath } = await import("../src/core/invoice.js");
    const config = makeConfig();
    config.quote.outputDir = path.join(HOME, "quotes", "{year}");
    const p1 = resolveOutputPath(config, quoteDoc(config), ISSUE);
    assert.ok(
      p1.startsWith(path.join(HOME, "quotes", "2026")),
      `見積書の出力先が違います: ${p1}`,
    );
    assert.ok(path.basename(p1).startsWith("見積書_"), path.basename(p1));
  });
});

after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});
