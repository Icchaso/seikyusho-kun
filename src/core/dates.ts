/**
 * 日付の解釈と表示。
 * 「締日は？」に対して 月末 / 来月末 / 2026-09-30 / 9/30 / 30日後 のどれで答えても通す。
 */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 月をまたぐときに日付が溢れないように加算する (1/31 +1ヶ月 → 2/28) */
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = endOfMonth(target).getDate();
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(d.getDate(), last),
  );
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function isEndOfMonth(d: Date): boolean {
  return d.getDate() === endOfMonth(d).getDate();
}

export function formatISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 2026年9月30日 */
export function formatJP(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 全角数字を半角に落とす */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

const KANJI_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/**
 * 「締日」の文字列を実際の日付に変換する。
 * 対応: 月末/今月末/末日/月末締め、来月末/翌月末、翌々月末、今日、明日、
 *       2026-09-30、2026/9/30、9/30、30日、+30、30日後、翌月10日
 * 解釈できない場合は null を返す(呼び出し側でエラーにする)。
 */
export function parseDue(input: string, base = new Date()): Date | null {
  const s = toHalfWidth(String(input).trim()).replace(/\s+/g, "");
  if (!s) return null;
  const today = startOfDay(base);

  if (/^(今日|本日)$/.test(s)) return today;
  if (/^明日$/.test(s)) return addDays(today, 1);

  // 月末系
  if (/^(月末|今月末|末日|今月末日)(締め?)?$/.test(s)) return endOfMonth(today);
  if (/^(来月末|翌月末|来月末日|翌月末日)(締め?)?$/.test(s)) {
    return endOfMonth(addMonths(today, 1));
  }
  if (/^(翌々月末|再来月末)(締め?)?$/.test(s)) {
    return endOfMonth(addMonths(today, 2));
  }
  // Nヶ月後の末日
  const monthEnd = s.match(/^(\d+)[ヶか]?月後(の)?末日?$/);
  if (monthEnd?.[1]) return endOfMonth(addMonths(today, Number(monthEnd[1])));

  // 来月10日 / 翌月10日
  const nextMonthDay = s.match(/^(来月|翌月)(\d+|[一二三四五六七八九十]+)日$/);
  if (nextMonthDay?.[2]) {
    const day = Number(nextMonthDay[2]) || KANJI_NUM[nextMonthDay[2]];
    if (day) {
      const nm = addMonths(today, 1);
      return new Date(nm.getFullYear(), nm.getMonth(), day);
    }
  }

  // +30 / 30日後 / 30日以内(「30日」だけは今月の30日と解釈するので下で扱う)
  const rel = s.match(/^\+(\d+)日?$/) ?? s.match(/^(\d+)日(後|以内)$/);
  if (rel?.[1]) return addDays(today, Number(rel[1]));

  // 2026-09-30 / 2026/9/30 / 2026年9月30日
  const full = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  if (full?.[1] && full[2] && full[3]) {
    return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
  }

  // 9/30 / 9月30日 → 今年。すでに過ぎていれば来年
  const md = s.match(/^(\d{1,2})[-/月](\d{1,2})日?$/);
  if (md?.[1] && md[2]) {
    const cand = new Date(today.getFullYear(), Number(md[1]) - 1, Number(md[2]));
    return cand < today
      ? new Date(today.getFullYear() + 1, Number(md[1]) - 1, Number(md[2]))
      : cand;
  }

  // 30日 → 今月の30日。すでに過ぎていれば来月の30日
  const dayOnly = s.match(/^(\d{1,2})日$/);
  if (dayOnly?.[1]) {
    const day = Number(dayOnly[1]);
    const cand = new Date(today.getFullYear(), today.getMonth(), day);
    if (cand >= today) return cand;
    const nm = addMonths(today, 1);
    return new Date(nm.getFullYear(), nm.getMonth(), day);
  }

  return null;
}

/** 定期発行の「発行日」指定(1〜31 または "末日")が、その日に当たるか */
export function matchesScheduleDay(day: number | "末日", d: Date): boolean {
  if (day === "末日") return isEndOfMonth(d);
  const last = endOfMonth(d).getDate();
  // 31日指定で30日までしかない月は、その月の末日に発行する
  const effective = Math.min(day, last);
  return d.getDate() === effective;
}
