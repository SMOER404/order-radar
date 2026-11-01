import { Filters } from '../config/filters';
import { normalize, normalizeKeyword } from '../common/text';

export interface FilterResult {
  pass: boolean;
  reason?: string;
  nicheTags: string[];
}

// Поиск по подстроке. Пробелы в словах из конфига значимы: " js " — отдельное слово, " лк" — начало слова.
const has = (text: string, word: string) => {
  const w = normalizeKeyword(word);
  return w.trim().length > 0 && text.includes(w);
};

export function applyFilters(title: string, description: string, filters: Filters): FilterResult {
  const text = normalize(`${title}\n${description}`);
  const nicheTags = Object.entries(filters.niches)
    .filter(([, words]) => words.some((w) => has(text, w)))
    .map(([tag]) => tag);

  const stop = filters.stopWords.find((w) => has(text, w));
  if (stop) return { pass: false, reason: `стоп-слово: «${stop.trim()}»`, nicheTags };

  if (description.trim().length < 30 && title.trim().length < 30) {
    return { pass: false, reason: 'нет описания', nicheTags };
  }

  // ниша проходит всегда, даже без ключевых слов
  if (nicheTags.length === 0 && filters.includeKeywords.length > 0) {
    const hit = filters.includeKeywords.some((w) => has(text, w));
    if (!hit) return { pass: false, reason: 'нет ключевых слов', nicheTags };
  }
  return { pass: true, nicheTags };
}
