/**
 * A4 1枚に収めるオートフィット。
 * 生成 → ページ数を実測 → 溢れていたら密度段を1つ上げて再生成、を繰り返す。
 * 「CSSを詰めたから大丈夫」ではなく、出来たPDFのページ数を数えて判断する。
 */
import type { Config, InvoiceDoc } from "./types.js";
import { htmlToPdf } from "./chrome.js";
import { pdfPageCount } from "./pdf.js";
import { renderHtml } from "./render.js";

/** 左から順に「緩い → 詰まる」 */
export const DENSITY_TIERS = ["d1", "d2", "d3", "d4"] as const;
export type Density = (typeof DENSITY_TIERS)[number];

export interface FitResult {
  density: Density;
  pages: number;
  html: string;
}

/** 明細件数から起点の密度段を推定する(そこから足りなければ自動で上げる) */
export function guessDensity(itemCount: number): Density {
  if (itemCount <= 4) return "d1";
  if (itemCount <= 9) return "d2";
  if (itemCount <= 16) return "d3";
  return "d4";
}

/**
 * PDFを出す。1枚に収まるまで密度段を上げ、それでも溢れたら
 * 複数ページとして受け入れ、ページ番号を焼き込んで最終生成する(2パス方式)。
 */
export function buildPdf(
  doc: InvoiceDoc,
  config: Config,
  outPath: string,
  startDensity?: Density,
): FitResult {
  const start = startDensity ?? guessDensity(doc.items.length);
  const startIndex = DENSITY_TIERS.indexOf(start);

  let html = "";
  let pages = 1;
  let density: Density = start;

  for (let i = startIndex; i < DENSITY_TIERS.length; i++) {
    density = DENSITY_TIERS[i] as Density;
    html = renderHtml({ ...doc, density, pageLabel: "" }, config);
    htmlToPdf(html, outPath);
    pages = pdfPageCount(outPath);
    if (pages <= 1) return { density, pages, html };
  }

  // d4 でも溢れる = 明細が多い請求書。複数ページを正として、ページ番号を入れて出し直す。
  html = renderHtml({ ...doc, density, pageLabel: `1 / ${pages}` }, config);
  htmlToPdf(html, outPath);
  const finalPages = pdfPageCount(outPath);
  if (finalPages !== pages) {
    html = renderHtml(
      { ...doc, density, pageLabel: `1 / ${finalPages}` },
      config,
    );
    htmlToPdf(html, outPath);
  }
  return { density, pages: finalPages, html };
}
