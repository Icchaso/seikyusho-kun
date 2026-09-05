/** ユーザーが打ち込んだ文字列をデータに変換する */
import type { LineItem, TaxRate } from "./types.js";

function toHalfWidth(s: string): string {
  return s.replace(/[０-９．，]/g, (ch) => {
    if (ch === "．") return ".";
    if (ch === "，") return ",";
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

/**
 * 金額の入力を数値にする。
 * 150000 / 150,000 / ¥150000 / 15万 / 1.5万 / 15万円 / 3千 をすべて受ける。
 */
export function parseAmount(input: string | number): number {
  if (typeof input === "number") return Math.round(input);
  const s = toHalfWidth(String(input))
    .trim()
    .replace(/[¥￥\s,]/g, "")
    .replace(/円$/, "");
  if (!s) throw new Error("金額が空です");

  const man = s.match(/^(\d+(?:\.\d+)?)万(\d+(?:\.\d+)?)?(千)?$/);
  if (man?.[1]) {
    let v = Number(man[1]) * 10000;
    if (man[2]) v += Number(man[2]) * (man[3] ? 1000 : 1);
    return Math.round(v);
  }
  const sen = s.match(/^(\d+(?:\.\d+)?)千$/);
  if (sen?.[1]) return Math.round(Number(sen[1]) * 1000);

  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`金額として読めません: ${input}`);
  return Math.round(n);
}

export function parseTaxRate(input: string | number | undefined): TaxRate | undefined {
  if (input === undefined || input === "") return undefined;
  const n = Number(String(input).replace(/[%％\s]/g, ""));
  if (n === 10) return 10;
  if (n === 8) return 8;
  if (n === 0) return 0;
  throw new Error(`税率は 10 / 8 / 0 のいずれかです: ${input}`);
}

/** 明細に関わるオプション。--item が現れるたびに新しい行が始まる */
const ITEM_FLAGS = ["--amount", "--qty", "--unit", "--rate", "--note"] as const;
type ItemFlag = (typeof ITEM_FLAGS)[number];

function applyFlag(item: LineItem, flag: ItemFlag, value: string): void {
  switch (flag) {
    case "--amount":
      item.amount = parseAmount(value);
      break;
    case "--qty": {
      const n = Number(toHalfWidth(value).replace(/[^\d.]/g, ""));
      item.qty = Number.isFinite(n) && n > 0 ? n : 1;
      break;
    }
    case "--unit":
      item.unit = value;
      break;
    case "--rate": {
      const rate = parseTaxRate(value);
      if (rate !== undefined) item.taxRate = rate;
      break;
    }
    case "--note":
      item.note = value;
      break;
  }
}

/**
 * コマンドラインを **並び順のまま** 読んで明細を組み立てる。
 *
 *   --item 制作費 --amount 150000 --item 撮影 --amount 50000 --qty 4 --unit 点
 *     → 1行目: 制作費 150,000円
 *       2行目: 撮影 4点 50,000円
 *
 * index で機械的に突き合わせると、--qty を書いた行と書かない行が混ざったときに
 * 別の明細へずれてしまうため、必ず「直前の --item」に結びつける。
 * 明細に関係しない引数は rest に残して parseArgs へ渡す。
 */
export function extractItemArgs(argv: string[]): {
  items: LineItem[];
  rest: string[];
} {
  const items: LineItem[] = [];
  const rest: string[] = [];

  const takeValue = (i: number, token: string, inline?: string): [string, number] => {
    if (inline !== undefined) return [inline, i];
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${token} の値がありません`);
    }
    return [next, i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    const eq = token.indexOf("=");
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;

    if (name === "--item") {
      const [value, next] = takeValue(i, name, inline);
      items.push({ name: value });
      i = next;
      continue;
    }

    if ((ITEM_FLAGS as readonly string[]).includes(name)) {
      const [value, next] = takeValue(i, name, inline);
      const current = items[items.length - 1];
      if (!current) {
        throw new Error(
          `${name} は --item のあとに書いてください（例: --item "制作費" ${name} ...）`,
        );
      }
      applyFlag(current, name as ItemFlag, value);
      i = next;
      continue;
    }

    rest.push(token);
  }

  return { items, rest };
}
