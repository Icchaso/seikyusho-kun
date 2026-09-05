/** 生成した PDF を外部ライブラリなしで検査する */
import fs from "node:fs";

/**
 * PDFのページ数を数える。
 * Pagesツリーの /Count を最優先し、取れなければ /Type /Page の出現数で代替する。
 */
export function pdfPageCount(pdfPath: string): number {
  const data = fs.readFileSync(pdfPath);
  const text = data.toString("latin1");

  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  if (counts.length > 0) return Math.max(...counts);

  const pages = text.match(/\/Type\s*\/Page[^s]/g);
  return pages ? pages.length : 1;
}
