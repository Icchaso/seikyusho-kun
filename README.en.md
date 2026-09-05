# seikyusho-kun (請求書くん)

Say four things — **who, what, how much, when it's due** — and get an invoice PDF.
Built for Japanese invoicing: qualified invoices (インボイス制度), reduced tax rates,
and withholding tax.

<p align="center">
  <img src="docs/images/sample-plain.png" width="46%" alt="plain theme">
  <img src="docs/images/sample-modern.png" width="46%" alt="modern theme">
</p>

> The interface, templates and documentation are in Japanese, because Japanese
> invoicing conventions are what this tool is built around.

## Install

```bash
npm install -g github:Icchaso/seikyusho-kun
seikyusho-kun init   # one-time setup
seikyusho-kun new    # issue an invoice
```

> Not on npm yet — install from GitHub for now. Once published,
> `npx seikyusho-kun` will work directly.

Requires **Node.js 18.17+** and any Chromium-based browser (Chrome, Edge,
Chromium, Brave) — used as the PDF engine. Nothing else to install; the package
does **not** download its own Chromium.

## Usage

```bash
seikyusho-kun new --to "株式会社ABC" --item "Web development" --amount 150000 --due 月末
```

Multiple line items — quantity and unit attach to the `--item` that precedes them:

```bash
seikyusho-kun new --to "株式会社ABC" \
  --item "Development" --amount 300000 \
  --item "Photography" --amount 50000 --qty 4  --unit 点 \
  --item "Maintenance" --amount 60000 --qty 12 --unit ヶ月 \
  --due 翌月末
```

## What it does

- **Qualified invoice (適格請求書) compliance** — registration number, per-rate
  subtotals, per-rate consumption tax
- **Reduced tax rate (8%)** mixed with the standard 10% rate, marked with `※`
- **Withholding tax** — 10.21%, 20.42% above ¥1,000,000 — with the resulting
  net transfer amount
- **Rounding happens once per tax rate**, not per line, so totals never drift
- **Fits A4 in one page automatically** — it counts the pages of the generated
  PDF and tightens the typography until it fits; beyond that it paginates with a
  repeating table header and page numbers
- **Three themes** (`plain`, `modern`, `compact`), or eject the HTML/CSS and make
  it your own
- **Email delivery** via Resend or SMTP — always a dry run first, never sends
  without `--yes`
- **Recurring invoices** — monthly schedules registered with launchd / cron /
  Task Scheduler
- **`afterIssue` hook** — run any command after issuing, with the invoice data in
  environment variables

## Commands

| Command | |
|---|---|
| `init` | Set up issuer details, bank account, theme |
| `new` | Issue an invoice |
| `list` | List issued invoices |
| `clients` | Manage counterparties |
| `theme` | Switch themes, eject templates |
| `send` | Email an invoice (dry run by default) |
| `schedule` / `run-due` | Recurring invoices |
| `doctor` | Verify everything works by actually producing a PDF |

## Your data stays local

Everything lives in `~/.seikyusho-kun/` on your machine. Nothing is sent anywhere
unless you configure email yourself. API keys go to `~/.seikyusho-kun/.env` with
mode 600, never into `config.json`.

## Disclaimer

This tool helps you *produce* invoices. Correctness of the contents, tax
treatment, and compliance with the Japanese qualified invoice system remain your
responsibility. Consult a tax accountant when in doubt.

## License

[MIT](LICENSE)
