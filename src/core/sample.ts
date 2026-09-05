/** テーマのプレビューや動作確認に使うサンプル請求書 */
import type { Client, Config, LineItem } from "./types.js";
import { addDays, endOfMonth } from "./dates.js";
import { buildInvoiceDoc } from "./invoice.js";

export const SAMPLE_CLIENT: Client = {
  name: "サンプル商事株式会社",
  contact: "見本 花子",
  zip: "123-4567",
  address: "東京都千代田区サンプル1-2-3 サンプルビル10F",
};

export const SAMPLE_ITEMS: LineItem[] = [
  { name: "ホームページ制作費", qty: 1, unit: "式", amount: 300000 },
  { name: "写真撮影", qty: 4, unit: "点", unitPrice: 12500 },
  { name: "保守サポート（初年度）", qty: 12, unit: "ヶ月", unitPrice: 5000 },
];

/** 明細をN件に増やしたサンプル(レイアウト検証用) */
export function sampleItems(count: number): LineItem[] {
  const items: LineItem[] = [];
  for (let i = 0; i < count; i++) {
    const base = SAMPLE_ITEMS[i % SAMPLE_ITEMS.length] as LineItem;
    items.push({ ...base, name: count > 3 ? `${base.name} ${i + 1}` : base.name });
  }
  return items;
}

export function sampleDoc(config: Config, items: LineItem[] = SAMPLE_ITEMS) {
  const issueDate = new Date();
  return buildInvoiceDoc({
    config,
    client: SAMPLE_CLIENT,
    items,
    invoiceNo: "SAMPLE-001",
    issueDate,
    dueDate: endOfMonth(addDays(issueDate, 20)),
  });
}
