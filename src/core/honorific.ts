/** 宛名の敬称。法人なら「御中」、個人なら「様」 */

const CORP_MARKERS = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
  "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
  "社会福祉法人", "医療法人", "学校法人", "宗教法人", "特定非営利活動法人",
  "社団法人", "財団法人", "法人", "組合", "協会", "会社", "商店", "事務所",
  "Inc", "Inc.", "Co.", "Ltd", "Ltd.", "LLC", "Corp", "Corporation", "K.K.",
];

export function guessHonorific(clientName: string): string {
  const name = clientName ?? "";
  return CORP_MARKERS.some((m) => name.includes(m)) ? "御中" : "様";
}
