/** 締日の解釈と入力パースのテスト */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatISO, formatJP, matchesScheduleDay, parseDue } from "../src/core/dates.js";
import { extractItemArgs, parseAmount, parseTaxRate } from "../src/core/parse.js";

// 基準日は 2026-09-05(土)
const BASE = new Date(2026, 8, 5);

function due(input: string): string {
  const d = parseDue(input, BASE);
  assert.ok(d, `解釈できませんでした: ${input}`);
  return formatISO(d);
}

describe("締日の解釈", () => {
  it("月末系", () => {
    assert.equal(due("月末"), "2026-09-30");
    assert.equal(due("今月末"), "2026-09-30");
    assert.equal(due("末日"), "2026-09-30");
    assert.equal(due("月末締め"), "2026-09-30");
    assert.equal(due("翌月末"), "2026-10-31");
    assert.equal(due("来月末"), "2026-10-31");
    assert.equal(due("翌々月末"), "2026-11-30");
  });

  it("日付の直接指定", () => {
    assert.equal(due("2026-09-30"), "2026-09-30");
    assert.equal(due("2026/9/30"), "2026-09-30");
    assert.equal(due("2026年9月30日"), "2026-09-30");
  });

  it("月日だけの指定は、過ぎていれば翌年", () => {
    assert.equal(due("9/30"), "2026-09-30");
    assert.equal(due("9月30日"), "2026-09-30");
    assert.equal(due("1/31"), "2027-01-31");
  });

  it("相対指定", () => {
    assert.equal(due("30日後"), "2026-10-05");
    assert.equal(due("+45"), "2026-10-20");
    assert.equal(due("今日"), "2026-09-05");
    assert.equal(due("明日"), "2026-09-06");
    assert.equal(due("来月10日"), "2026-10-10");
  });

  it("全角数字も受ける", () => {
    assert.equal(due("２０２６-０９-３０"), "2026-09-30");
  });

  it("解釈できないものは null", () => {
    assert.equal(parseDue("いいかんじに", BASE), null);
    assert.equal(parseDue("", BASE), null);
  });
});

describe("表示", () => {
  it("和暦なしの日本語表記", () => {
    assert.equal(formatJP(new Date(2026, 8, 30)), "2026年9月30日");
  });
});

describe("定期発行の発行日判定", () => {
  it("末日指定はその月の最終日に当たる", () => {
    assert.equal(matchesScheduleDay("末日", new Date(2026, 8, 30)), true);
    assert.equal(matchesScheduleDay("末日", new Date(2026, 8, 29)), false);
    assert.equal(matchesScheduleDay("末日", new Date(2026, 1, 28)), true); // 2026年2月
  });

  it("31日指定は、31日が無い月では末日に繰り上がる", () => {
    assert.equal(matchesScheduleDay(31, new Date(2026, 8, 30)), true); // 9月30日
    assert.equal(matchesScheduleDay(31, new Date(2026, 9, 31)), true); // 10月31日
    assert.equal(matchesScheduleDay(31, new Date(2026, 9, 30)), false);
  });

  it("通常の日付指定", () => {
    assert.equal(matchesScheduleDay(25, new Date(2026, 8, 25)), true);
    assert.equal(matchesScheduleDay(25, new Date(2026, 8, 26)), false);
  });
});

describe("金額の入力", () => {
  it("いろいろな書き方を受ける", () => {
    assert.equal(parseAmount("150000"), 150_000);
    assert.equal(parseAmount("150,000"), 150_000);
    assert.equal(parseAmount("¥150,000"), 150_000);
    assert.equal(parseAmount("150000円"), 150_000);
    assert.equal(parseAmount("15万"), 150_000);
    assert.equal(parseAmount("1.5万"), 15_000);
    assert.equal(parseAmount("15万3000"), 153_000);
    assert.equal(parseAmount("3千"), 3_000);
    assert.equal(parseAmount("１５００００"), 150_000);
  });

  it("読めない入力はエラー", () => {
    assert.throws(() => parseAmount("たくさん"), /金額/);
  });
});

describe("税率の入力", () => {
  it("10 / 8 / 0 を受ける", () => {
    assert.equal(parseTaxRate("10"), 10);
    assert.equal(parseTaxRate("8%"), 8);
    assert.equal(parseTaxRate("0"), 0);
    assert.equal(parseTaxRate(undefined), undefined);
  });
  it("それ以外はエラー", () => {
    assert.throws(() => parseTaxRate("5"), /税率/);
  });
});

describe("明細の組み立て（引数の並び順で解釈する）", () => {
  it("--item のあとに書いたオプションがその明細に付く", () => {
    const { items, rest } = extractItemArgs([
      "--to", "株式会社ABC",
      "--item", "制作費", "--amount", "150000",
      "--item", "撮影", "--amount", "5万", "--qty", "4", "--unit", "点",
      "--due", "月末",
    ]);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { name: "制作費", amount: 150_000 });
    assert.deepEqual(items[1], { name: "撮影", amount: 50_000, qty: 4, unit: "点" });
    assert.deepEqual(rest, ["--to", "株式会社ABC", "--due", "月末"]);
  });

  it("数量を書いた明細と書かない明細が混ざってもズレない", () => {
    const { items } = extractItemArgs([
      "--item", "A", "--amount", "300000",
      "--item", "B", "--amount", "50000", "--qty", "4", "--unit", "点",
      "--item", "C", "--amount", "60000", "--qty", "12", "--unit", "ヶ月",
    ]);
    assert.equal(items[0]?.qty, undefined);
    assert.equal(items[1]?.qty, 4);
    assert.equal(items[1]?.unit, "点");
    assert.equal(items[2]?.qty, 12);
    assert.equal(items[2]?.unit, "ヶ月");
  });

  it("--item=値 の書き方も受ける", () => {
    const { items } = extractItemArgs(["--item=制作費", "--amount=150000", "--rate=8"]);
    assert.deepEqual(items[0], { name: "制作費", amount: 150_000, taxRate: 8 });
  });

  it("--item より前に --amount を書いたらエラーにする", () => {
    assert.throws(() => extractItemArgs(["--amount", "100"]), /--item のあとに/);
  });
});
