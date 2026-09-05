/** Nunjucks でテンプレートを HTML にする */
import fs from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import type { Config, InvoiceDoc } from "./types.js";
import { bundledTemplatesDir, templatesDir } from "./paths.js";

export const BUILTIN_THEMES = ["plain", "modern", "compact"] as const;
export type BuiltinTheme = (typeof BUILTIN_THEMES)[number];

export function isBuiltinTheme(name: string): name is BuiltinTheme {
  return (BUILTIN_THEMES as readonly string[]).includes(name);
}

export interface ResolvedTheme {
  name: string;
  /** テンプレート探索パス(先頭が優先) */
  searchPaths: string[];
  /** テーマCSSの中身 */
  css: string;
  builtin: boolean;
}

/**
 * テーマを解決する。
 * - 内蔵テーマ: templates/themes/<name>.css
 * - 自作テーマ: ~/.seikyusho-kun/templates/<name>/ (invoice.njk と theme.css)
 */
export function resolveTheme(name: string): ResolvedTheme {
  const bundled = bundledTemplatesDir();
  const userDir = path.join(templatesDir(), name);

  if (fs.existsSync(userDir) && fs.statSync(userDir).isDirectory()) {
    const cssPath = path.join(userDir, "theme.css");
    return {
      name,
      searchPaths: [userDir, bundled],
      css: fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "",
      builtin: false,
    };
  }

  const builtinCss = path.join(bundled, "themes", `${name}.css`);
  if (!fs.existsSync(builtinCss)) {
    throw new Error(
      `テーマ「${name}」が見つかりません。` +
        `\n  内蔵テーマ: ${BUILTIN_THEMES.join(" / ")}` +
        `\n  自作テーマは ~/.seikyusho-kun/templates/<名前>/ に置きます` +
        `\n  一覧は \`seikyusho-kun theme list\` で見られます`,
    );
  }
  return {
    name,
    searchPaths: [bundled],
    css: fs.readFileSync(builtinCss, "utf-8"),
    builtin: true,
  };
}

function readBaseCss(): string {
  return fs.readFileSync(path.join(bundledTemplatesDir(), "base.css"), "utf-8");
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** ロゴを data URI に埋め込む(Chrome に file:// のパス解決をさせないため) */
export function logoToDataUri(logoPath?: string): string | undefined {
  if (!logoPath) return undefined;
  const p = logoPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", logoPath.slice(1))
    : logoPath;
  if (!fs.existsSync(p)) return undefined;
  const mime = MIME[path.extname(p).toLowerCase()];
  if (!mime) return undefined;
  return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
}

/**
 * レイアウトを実測するためのスクリプト。
 * ページ側で測った値を <html data-measure="..."> に書き、Chrome の --dump-dom で回収する。
 */
const MEASURE_SCRIPT = `<script>
(function () {
  function rect(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var b = el.getBoundingClientRect();
    return { top: b.top + window.scrollY, bottom: b.bottom + window.scrollY,
             left: b.left, right: b.right, width: b.width, height: b.height };
  }
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:100mm;width:100mm;';
  document.body.appendChild(probe);
  var mm = probe.getBoundingClientRect().height / 100;
  probe.parentNode.removeChild(probe);

  var m = {
    mmPx: mm,
    bodyHeight: document.body.scrollHeight,
    minHeightPx: parseFloat(getComputedStyle(document.body).minHeight) || 0,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth
  };
  var hd = rect('.hd'), ft = rect('.ft'), items = rect('.items'), grand = rect('.grand');
  if (hd) { m.headerTop = hd.top; m.headerBottom = hd.bottom; m.headerWidth = hd.width; }
  if (ft) { m.footerTop = ft.top; m.footerBottom = ft.bottom; }
  if (items) { m.itemsTop = items.top; m.itemsBottom = items.bottom; m.itemsRight = items.right; }
  if (grand) { m.grandBottom = grand.bottom; }
  document.documentElement.setAttribute('data-measure', JSON.stringify(m));
})();
</script>`;

export interface RenderOptions {
  /** レイアウト実測用のスクリプトを埋め込む */
  measure?: boolean;
}

let envCache: { key: string; env: nunjucks.Environment } | null = null;

function getEnv(searchPaths: string[]): nunjucks.Environment {
  const key = searchPaths.join("|");
  if (envCache?.key === key) return envCache.env;
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(searchPaths, { noCache: true }),
    { autoescape: true, trimBlocks: true, lstripBlocks: true },
  );
  env.addFilter("yen", (n: unknown) => {
    const v = typeof n === "number" ? n : Number(n);
    return Number.isFinite(v) ? v.toLocaleString("ja-JP") : String(n);
  });
  envCache = { key, env };
  return env;
}

export function renderHtml(
  doc: InvoiceDoc,
  config: Config,
  opts: RenderOptions = {},
): string {
  const theme = resolveTheme(config.theme);
  const env = getEnv(theme.searchPaths);

  const styles = [
    readBaseCss(),
    theme.css,
    `:root { --accent: ${doc.accentColor || config.accentColor}; }`,
  ].join("\n\n");

  const cols = doc.totals.hasReduced ? 5 : 4;
  const singleRate = doc.totals.buckets[0]?.rate ?? config.tax.defaultRate;

  return env.render("invoice.njk", {
    ...doc,
    theme: theme.name,
    styles,
    cols,
    singleRate,
    measureScript: opts.measure ? MEASURE_SCRIPT : "",
  });
}
