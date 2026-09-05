#!/bin/bash
# 発行後フックの例。
# config.json の hooks.afterIssue にこのファイルのパスを書くと、
# 請求書を発行するたびに実行されます。
#
# 渡ってくる環境変数:
#   INVOICE_PDF         生成されたPDFのフルパス
#   INVOICE_NO          請求書番号
#   INVOICE_ISSUE_DATE  発行日 (YYYY-MM-DD)
#   INVOICE_DUE_DATE    支払期限 (YYYY-MM-DD)
#   CLIENT_NAME         取引先名
#   INVOICE_SUBTOTAL    税抜合計
#   INVOICE_TAX         消費税額
#   INVOICE_TOTAL       税込合計
#   INVOICE_PAYABLE     お振込金額(源泉徴収後)
#   INVOICE_JSON        請求書の全内容(JSON)

set -euo pipefail

LEDGER="$HOME/Documents/請求書台帳.csv"

# 台帳(CSV)に1行追記する例
if [ ! -f "$LEDGER" ]; then
  echo "発行日,請求書番号,取引先,税抜,消費税,税込,振込額,支払期限,PDF" > "$LEDGER"
fi
echo "${INVOICE_ISSUE_DATE},${INVOICE_NO},${CLIENT_NAME},${INVOICE_SUBTOTAL},${INVOICE_TAX},${INVOICE_TOTAL},${INVOICE_PAYABLE},${INVOICE_DUE_DATE},${INVOICE_PDF}" >> "$LEDGER"

# 会計ソフトのAPIに投げる、Slackに通知する、クラウドに同期する、なども
# ここに書けます。終了コードが 0 以外だと警告が出ます(請求書の発行自体は成功のまま)。
