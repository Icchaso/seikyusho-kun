/**
 * 対話で聞く部分の共通部品。
 * 請求書と見積書で同じことを二度聞く形にならないよう、ここにまとめている。
 * what には「請求書」「見積書」など、画面に出す書類名を渡す。
 */
import * as p from "@clack/prompts";
import type { Client, Config, LineItem } from "./types.js";
import { parseAmount } from "./parse.js";
import { findClient, listClients } from "./store.js";

export function cancelled(what = "請求書"): never {
  p.cancel(`中止しました。${what}は発行していません。`);
  process.exit(130);
}

/** 宛先を決める。保存済みがあれば選ばせ、無ければ入力させる */
export async function askClient(
  preset?: string,
  what = "請求書",
): Promise<Client> {
  if (preset) {
    const found = findClient(preset);
    if (found) return found;
    return { name: preset };
  }

  const saved = listClients();
  if (saved.length > 0) {
    const choice = await p.select({
      message: "宛先は？",
      options: [
        ...saved.map((cl) => ({
          value: cl.name,
          label: cl.name,
          hint: cl.contact ? `ご担当 ${cl.contact}` : undefined,
        })),
        { value: "__new__", label: "＋ 新しい宛先を入力する" },
      ],
    });
    if (p.isCancel(choice)) cancelled(what);
    if (choice !== "__new__") {
      return findClient(String(choice)) ?? { name: String(choice) };
    }
  }

  const name = await p.text({
    message: "宛先は？",
    placeholder: "株式会社ABC",
    validate: (v) => (v.trim() ? undefined : "宛先を入力してください"),
  });
  if (p.isCancel(name)) cancelled(what);
  return { name: String(name).trim() };
}

/** 明細を1行ずつ聞く */
export async function askItems(
  config: Config,
  what = "請求書",
): Promise<LineItem[]> {
  const items: LineItem[] = [];
  for (;;) {
    const name = await p.text({
      message: items.length === 0 ? "名目は？" : "次の名目は？（空欄で終了）",
      placeholder: items.length === 0 ? "ホームページ制作費" : "",
      validate: (v) =>
        items.length === 0 && !v.trim() ? "名目を入力してください" : undefined,
    });
    if (p.isCancel(name)) cancelled(what);
    const label = String(name).trim();
    if (!label) break;

    const amount = await p.text({
      message: `金額は？（${config.tax.mode === "inclusive" ? "税込" : "税抜"}）`,
      placeholder: "150000  /  15万 でも可",
      validate: (v) => {
        try {
          parseAmount(v);
          return undefined;
        } catch {
          return "金額を数字で入力してください";
        }
      },
    });
    if (p.isCancel(amount)) cancelled(what);

    items.push({ name: label, amount: parseAmount(String(amount)) });

    const more = await p.confirm({
      message: "明細をもう1行足しますか？",
      initialValue: false,
    });
    if (p.isCancel(more)) cancelled(what);
    if (!more) break;
  }
  return items;
}
