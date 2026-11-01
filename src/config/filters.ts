import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const strList = z.array(z.string()).default([]);

export const filtersSchema = z.object({
  // Если встречается — заказ отбрасывается сразу, без LLM
  stopWords: strList,
  // Заказ проходит дальше, только если есть хотя бы одно из слов (пустой список = пропускать всё)
  includeKeywords: strList,
  // Свои ниши: заказ помечается ⭐ и тегом
  niches: z.record(z.string(), strList).default({}),
  // Дополнительные Telegram-каналы (складываются с TG_CHANNELS из .env)
  telegramChannels: strList,
  // Профиль для LLM: кто вы и что берёте
  profile: z.string().default(''),
});

export type Filters = z.infer<typeof filtersSchema>;

export function loadFilters(path: string): Filters {
  const raw = parse(readFileSync(path, 'utf8')) ?? {};
  return filtersSchema.parse(raw);
}
