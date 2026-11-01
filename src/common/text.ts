import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&laquo;': '«', '&raquo;': '»', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&#8381;': '₽',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

const stripTags = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '');

export function stripHtml(html: string): string {
  // дважды: Kwork иногда отдаёт HTML, закодированный сущностями (&lt;b&gt;)
  return stripTags(decodeEntities(stripTags(html)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Для поиска по словам: нижний регистр, ё→е, знаки препинания → пробел, пробелы схлопнуты, по краям пробел */
export function normalize(s: string): string {
  return ` ${normalizeKeyword(s).trim()} `;
}

/** Как normalize, но сохраняет пробелы по краям: « js » = отдельное слово, « лк» = начало слова */
export function normalizeKeyword(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9+#]+/g, ' ');
}

/** Хеш для межисточниковой дедупликации (один заказ в FL и в TG-канале) */
export function contentHash(title: string, description: string): string {
  const base = normalize(`${title} ${description}`.replace(/https?:\/\/\S+/g, ''))
    .replace(/[^a-zа-я0-9]+/g, '')
    .slice(0, 500);
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}

/**
 * Достаёт бюджет в рублях из текста: «Бюджет: 15 000 руб», «до 5000₽», «10к», «3 тыс. руб».
 * Возвращает максимальное найденное значение (бюджет «от и до» → верхняя граница).
 */
export function parseBudgetRub(text: string): number | undefined {
  const t = text.toLowerCase().replace(/ /g, ' ');
  const re = /(\d[\d\s]{0,9}(?:[.,]\d+)?)\s*(к|k|тыс\.?|тысяч)?\s*(₽|руб|р\.|р\b|rub)/gi;
  const re2 = /(?:бюджет|оплата|цена|стоимость)[^\d\n]{0,20}(\d[\d\s]{0,9})\s*(к|k|тыс\.?|тысяч)?/gi;
  const values: number[] = [];
  for (const r of [re, re2]) {
    for (const m of t.matchAll(r)) {
      let n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      if (m[2]) n *= 1000;
      if (n >= 100 && n <= 10_000_000) values.push(Math.round(n));
    }
  }
  return values.length ? Math.max(...values) : undefined;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
