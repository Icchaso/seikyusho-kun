/** 請求書くん のデータモデル */

/** 適用税率。0 は非課税・不課税・免税をまとめて扱う */
export type TaxRate = 10 | 8 | 0;

/** 外税(明細は税抜) / 内税(明細は税込) */
export type TaxMode = "exclusive" | "inclusive";

/** 消費税額の端数処理 */
export type Rounding = "floor" | "round" | "ceil";

/** 発行者(自分)の情報 */
export interface Issuer {
  /** 屋号 / 会社名 */
  name: string;
  /** 代表者名 */
  rep?: string;
  /** インボイス登録番号 (T + 13桁)。未登録(免税事業者)なら空でよい */
  regNo?: string;
  zip?: string;
  address?: string;
  tel?: string;
  email?: string;
  /** ロゴ画像のパス(PNG/JPG/SVG)。modern テーマで使う */
  logo?: string;
}

/** 振込先口座 */
export interface BankAccount {
  bank?: string;
  branch?: string;
  branchCode?: string;
  /** 普通 / 当座 */
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
}

/** 明細1行 */
export interface LineItem {
  /** 品名 */
  name: string;
  /** 数量。省略時は 1 */
  qty?: number;
  /** 単位 (式・回・個・時間 など) */
  unit?: string;
  /** 単価。省略時は amount / qty */
  unitPrice?: number;
  /** 金額。省略時は qty * unitPrice */
  amount?: number;
  /** 適用税率。省略時は設定の既定税率 */
  taxRate?: TaxRate;
  /** 品名の下に小さく出す補足 */
  note?: string;
}

/** 計算済みの明細1行(テンプレートに渡る形) */
export interface ComputedItem {
  name: string;
  note?: string;
  qty: number;
  unit: string;
  unitPrice: number;
  /** 税抜金額 */
  amountExcl: number;
  /** 税込金額 */
  amountIncl: number;
  taxRate: TaxRate;
  /** 軽減税率対象なら true (適格請求書では ※ 印で示す) */
  reduced: boolean;
}

/** 税率ごとの区分(適格請求書の必須記載事項) */
export interface TaxBucket {
  rate: TaxRate;
  /** その税率の対象となる税抜合計 */
  taxable: number;
  /** その税率の消費税額 */
  tax: number;
  /** その税率の税込合計 */
  total: number;
}

/** 請求書の合計まわり */
export interface Totals {
  /** 税率ごとの区分。税率の降順 */
  buckets: TaxBucket[];
  /** 税抜合計(小計) */
  subtotal: number;
  /** 消費税合計 */
  taxTotal: number;
  /** 税込合計(ご請求金額) */
  total: number;
  /** 源泉徴収税額(設定ONのときのみ) */
  withholding?: number;
  /** 実際に振り込まれる金額 = total - withholding */
  payable?: number;
  /** 軽減税率対象が含まれるか */
  hasReduced: boolean;
}

/** 定期発行の設定 */
export interface Schedule {
  /** 発行日。1〜31 の日付、または "末日" */
  day: number | "末日";
  /** 発行する明細(1行だけの簡易指定) */
  item?: string;
  amount?: number;
  qty?: number;
  unit?: string;
  taxRate?: TaxRate;
  /** 支払期日の指定 (月末 / 翌月末 / +30 など) */
  due?: string;
  /** true のときだけ発行後に自動でメール送信する。既定 false */
  email?: boolean;
  /** false にすると一時停止 */
  enabled?: boolean;
}

/** 取引先 */
export interface Client {
  name: string;
  /** 御中 / 様。省略時は社名から自動判定 */
  honorific?: string;
  /** 担当者名(「◯◯ 様」として宛名の下に出る) */
  contact?: string;
  email?: string;
  zip?: string;
  address?: string;
  tel?: string;
  /** この取引先の既定の明細・備考・支払期日 */
  defaults?: {
    items?: LineItem[];
    notes?: string[];
    due?: string;
  };
  schedule?: Schedule;
  createdAt?: string;
  updatedAt?: string;
}

/** メール送信の設定 */
export interface MailConfig {
  provider: "resend" | "smtp";
  /** 差出人表示名 */
  fromName?: string;
  /** 差出人アドレス */
  fromEmail?: string;
  /** 自分への控え */
  bcc?: string;
  /** SMTP のとき */
  smtp?: { host: string; port: number; secure?: boolean };
}

/** 消費税まわりの設定 */
export interface TaxConfig {
  mode: TaxMode;
  defaultRate: TaxRate;
  rounding: Rounding;
  /** 源泉徴収を計算するか(個人事業主で報酬から天引きされる人向け) */
  withholding: boolean;
}

/** ~/.seikyusho-kun/config.json */
export interface Config {
  version: number;
  issuer: Issuer;
  bank: BankAccount;
  tax: TaxConfig;
  /** plain / modern / compact / mine(eject したもの) */
  theme: string;
  /** modern テーマのメインカラー */
  accentColor: string;
  /** PDF の出力先。{year} を使える */
  outputDir: string;
  /** 出力ファイル名。{no} {client} {date} {year} {month} を使える */
  fileNamePattern: string;
  /** 請求書番号。{yyyy} {yy} {mm} {dd} {seq} {seq:3} を使える */
  invoiceNoPattern: string;
  /** 明細テーブルの最小行数(足りない分は空行を罫線で埋める) */
  minRows: number;
  /** 挨拶文 */
  greeting: string;
  /** 備考欄の既定 */
  notes: string[];
  mail?: MailConfig;
  hooks?: { afterIssue?: string };
}

/** テンプレートに渡す完成形 */
export interface InvoiceDoc {
  invoiceNo: string;
  /** 2026年9月5日 */
  issueDate: string;
  dueDate: string;
  issueDateISO: string;
  dueDateISO: string;
  client: {
    name: string;
    honorific: string;
    contact?: string;
    zip?: string;
    address?: string;
    tel?: string;
  };
  issuer: Issuer;
  bank: BankAccount;
  items: ComputedItem[];
  /** minRows に満たない分の空行数 */
  emptyRows: number;
  totals: Totals;
  taxMode: TaxMode;
  greeting: string;
  notes: string[];
  accentColor: string;
  /** 密度段 d1〜d4 */
  density: string;
  /** 多ページになったときのページ番号表示 (例 "1 / 2")。1ページなら空 */
  pageLabel: string;
  /** 明細に単位列を出すか */
  showUnit: boolean;
  logoDataUri?: string;
}
