/** 金額計算のテスト。手計算した期待値と突き合わせる */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcTotals, calcWithholding, normalizeItems } from "../src/core/money.js";
import type { LineItem, TaxConfig } from "../src/core/types.js";

const EXCLUSIVE: TaxConfig = {
  mode: "exclusive",
  defaultRate: 10,
  rounding: "floor",
  withholding: false,
};
const INCLUSIVE: TaxConfig = { ...EXCLUSIVE, mode: "inclusive" };

function totals(items: LineItem[], tax: TaxConfig) {
  return calcTotals(normalizeItems(items, tax), tax);
}

describe("外税(exclusive)", () => {
  it("150,000円 → 消費税15,000円 / 税込165,000円", () => {
    const t = totals([{ name: "制作費", amount: 150_000 }], EXCLUSIVE);
    assert.equal(t.subtotal, 150_000);
    assert.equal(t.taxTotal, 15_000);
    assert.equal(t.total, 165_000);
  });

  it("数量×単価で金額を出す", () => {
    const items = normalizeItems(
      [{ name: "写真", qty: 4, unitPrice: 12_500 }],
      EXCLUSIVE,
    );
    assert.equal(items[0]?.amountExcl, 50_000);
    assert.equal(calcTotals(items, EXCLUSIVE).total, 55_000);
  });

  it("端数は税率ごとに1回だけ処理する(行ごとに処理しない)", () => {
    // 1,005円 × 2行。行ごとに切り捨てると 100+100=200 になるが、
    // 適格請求書では合計2,010円に対して1回だけ処理するので 201 が正しい。
    const t = totals(
      [
        { name: "A", amount: 1_005 },
        { name: "B", amount: 1_005 },
      ],
      EXCLUSIVE,
    );
    assert.equal(t.taxTotal, 201);
    assert.equal(t.total, 2_211);
  });
});

describe("内税(inclusive)", () => {
  it("税込11,000円 → 消費税1,000円 / 税抜10,000円", () => {
    const t = totals([{ name: "顧問料", amount: 11_000 }], INCLUSIVE);
    assert.equal(t.taxTotal, 1_000);
    assert.equal(t.subtotal, 10_000);
    assert.equal(t.total, 11_000);
  });
});

describe("軽減税率(8%)との混在", () => {
  it("税率ごとに区分され、消費税もそれぞれ計算される", () => {
    const t = totals(
      [
        { name: "制作費", amount: 100_000, taxRate: 10 },
        { name: "お茶菓子", amount: 50_000, taxRate: 8 },
      ],
      EXCLUSIVE,
    );
    assert.equal(t.buckets.length, 2);
    assert.equal(t.hasReduced, true);

    const ten = t.buckets.find((b) => b.rate === 10);
    const eight = t.buckets.find((b) => b.rate === 8);
    assert.equal(ten?.taxable, 100_000);
    assert.equal(ten?.tax, 10_000);
    assert.equal(eight?.taxable, 50_000);
    assert.equal(eight?.tax, 4_000);

    assert.equal(t.subtotal, 150_000);
    assert.equal(t.taxTotal, 14_000);
    assert.equal(t.total, 164_000);
  });

  it("非課税(0%)は消費税0で区分される", () => {
    const t = totals(
      [
        { name: "制作費", amount: 100_000, taxRate: 10 },
        { name: "印紙代", amount: 200, taxRate: 0 },
      ],
      EXCLUSIVE,
    );
    assert.equal(t.taxTotal, 10_000);
    assert.equal(t.total, 110_200);
  });
});

describe("源泉徴収", () => {
  it("100万円以下は10.21%(切り捨て)", () => {
    assert.equal(calcWithholding(150_000), 15_315);
    assert.equal(calcWithholding(1_000_000), 102_100);
  });

  it("100万円を超えた部分は20.42%", () => {
    // 102,100 + floor(1,000,000 * 0.2042) = 102,100 + 204,200
    assert.equal(calcWithholding(2_000_000), 306_300);
  });

  it("お振込金額 = 税込合計 − 源泉徴収税額", () => {
    const t = totals([{ name: "原稿料", amount: 150_000 }], {
      ...EXCLUSIVE,
      withholding: true,
    });
    assert.equal(t.total, 165_000);
    assert.equal(t.withholding, 15_315);
    assert.equal(t.payable, 149_685);
  });
});

describe("入力の正規化", () => {
  it("金額も単価も無い明細はエラーにする", () => {
    assert.throws(() => normalizeItems([{ name: "謎" }], EXCLUSIVE), /金額も単価も/);
  });

  it("金額だけ渡したら数量1・単価=金額として扱う", () => {
    const [item] = normalizeItems([{ name: "一式", amount: 80_000 }], EXCLUSIVE);
    assert.equal(item?.qty, 1);
    assert.equal(item?.unitPrice, 80_000);
  });
});
