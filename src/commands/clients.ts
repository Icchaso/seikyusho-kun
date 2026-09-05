/** clients — 取引先の登録・確認・削除 */
import path from "node:path";
import * as p from "@clack/prompts";
import type { Client } from "../core/types.js";
import {
  deleteClient,
  findClient,
  listClients,
  saveClient,
} from "../core/store.js";
import { guessHonorific } from "../core/honorific.js";
import { clientsDir } from "../core/paths.js";
import * as ui from "../core/ui.js";

function cancelled(): never {
  p.cancel("中止しました。");
  process.exit(130);
}

function list(): number {
  const clients = listClients();
  if (clients.length === 0) {
    ui.info("取引先はまだ登録されていません。");
    ui.info(`請求書を1枚出せば自動で登録されます: ${ui.c.cyan("seikyusho-kun new")}`);
    return 0;
  }
  ui.heading(`取引先 ${clients.length}件`);
  ui.kv(
    clients.map((c): [string, string] => {
      const bits: string[] = [];
      if (c.contact) bits.push(`ご担当 ${c.contact}`);
      if (c.email) bits.push(c.email);
      if (c.schedule) {
        const day = c.schedule.day === "末日" ? "毎月末日" : `毎月${c.schedule.day}日`;
        bits.push(
          ui.c.cyan(`${day}に自動発行${c.schedule.email ? "＋メール" : ""}`),
        );
      }
      return [c.name, bits.join("  ") || ui.dim("—")];
    }),
  );
  console.log("");
  ui.info(`保存場所: ${clientsDir()}`);
  return 0;
}

function show(name: string): number {
  const c = findClient(name);
  if (!c) {
    ui.fail(`取引先「${name}」は見つかりませんでした`);
    return 1;
  }
  ui.heading(c.name);
  const rows: [string, string][] = [
    ["敬称", c.honorific || `${guessHonorific(c.name)}（自動判定）`],
  ];
  if (c.contact) rows.push(["ご担当", c.contact]);
  if (c.email) rows.push(["メール", c.email]);
  if (c.tel) rows.push(["電話", c.tel]);
  if (c.zip) rows.push(["郵便番号", c.zip]);
  if (c.address) rows.push(["住所", c.address]);
  if (c.defaults?.items?.length) {
    rows.push([
      "既定の明細",
      c.defaults.items
        .map((i) => `${i.name} ${i.amount ? ui.yen(i.amount) : ""}`)
        .join(" / "),
    ]);
  }
  if (c.schedule) {
    const s = c.schedule;
    rows.push([
      "定期発行",
      `${s.day === "末日" ? "毎月末日" : `毎月${s.day}日`} / ${s.item ?? "-"} ${
        s.amount ? ui.yen(s.amount) : ""
      } / メール${s.email ? "する" : "しない"}${s.enabled === false ? " / 停止中" : ""}`,
    ]);
  }
  rows.push(["ファイル", path.join(clientsDir(), `${c.name}.json`)]);
  ui.kv(rows);
  return 0;
}

async function add(preset?: string): Promise<number> {
  ui.requireInteractive("取引先の登録");
  p.intro(ui.c.bgCyan(ui.c.black(" 取引先の登録 ")));
  const nameInput =
    preset ??
    (await (async () => {
      const r = await p.text({
        message: "会社名 / 個人名は？",
        placeholder: "株式会社ABC",
        validate: (v) => (v.trim() ? undefined : "入力してください"),
      });
      if (p.isCancel(r)) cancelled();
      return String(r).trim();
    })());

  const contact = await p.text({
    message: "ご担当者名は？（省略可）",
    placeholder: "山田 太郎",
  });
  if (p.isCancel(contact)) cancelled();

  const email = await p.text({
    message: "請求書の送付先メールは？（省略可）",
    placeholder: "keiri@example.com",
  });
  if (p.isCancel(email)) cancelled();

  const zip = await p.text({ message: "郵便番号は？（省略可）", placeholder: "123-4567" });
  if (p.isCancel(zip)) cancelled();
  const address = await p.text({ message: "住所は？（省略可）", placeholder: "東京都..." });
  if (p.isCancel(address)) cancelled();

  const client: Client = {
    name: nameInput,
    ...(String(contact).trim() ? { contact: String(contact).trim() } : {}),
    ...(String(email).trim() ? { email: String(email).trim() } : {}),
    ...(String(zip).trim() ? { zip: String(zip).trim() } : {}),
    ...(String(address).trim() ? { address: String(address).trim() } : {}),
  };
  const file = saveClient(client);
  p.outro(`登録しました: ${file}`);
  return 0;
}

async function remove(name: string, yes: boolean): Promise<number> {
  const c = findClient(name);
  if (!c) {
    ui.fail(`取引先「${name}」は見つかりませんでした`);
    return 1;
  }
  if (!yes && ui.isInteractive()) {
    const r = await p.confirm({
      message: `「${c.name}」を削除しますか？（発行済みのPDFは消えません）`,
      initialValue: false,
    });
    if (p.isCancel(r) || !r) {
      ui.info("削除しませんでした。");
      return 0;
    }
  }
  deleteClient(c.name);
  ui.ok(`削除しました: ${c.name}`);
  return 0;
}

export interface ClientsArgs {
  _: string[];
  yes?: boolean;
}

export async function runClients(args: ClientsArgs): Promise<number> {
  const [sub, arg] = args._;
  switch (sub) {
    case undefined:
    case "list":
      return list();
    case "add":
      return add(arg);
    case "show":
      if (!arg) throw new Error("取引先名を指定してください");
      return show(arg);
    case "remove":
    case "rm":
      if (!arg) throw new Error("取引先名を指定してください");
      return remove(arg, Boolean(args.yes));
    default:
      throw new Error(
        `clients のサブコマンドは list / add / show / remove です（受け取った値: ${sub}）`,
      );
  }
}
