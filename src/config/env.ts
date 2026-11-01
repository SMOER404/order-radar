import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  // Расписание: каждые N минут (15–30 по ТЗ)
  COLLECT_INTERVAL_MIN: z.coerce.number().int().min(5).max(180).default(20),
  FILTERS_PATH: z.string().default('config/filters.yaml'),

  // Источники
  FL_ENABLED: bool.default('true'),
  FL_RSS_URLS: list.default('https://www.fl.ru/rss/all.xml?category=5'),
  KWORK_ENABLED: bool.default('true'),
  // c=11 «Разработка и IT»; можно перечислить несколько через запятую
  KWORK_CATEGORIES: list.default('11'),
  KWORK_PAGES: z.coerce.number().int().min(1).max(5).default(1),
  TG_ENABLED: bool.default('false'),
  TG_API_ID: z.coerce.number().int().optional(),
  TG_API_HASH: z.string().optional(),
  TG_SESSION: z.string().optional(),
  // Каналы через запятую (@username или ссылка t.me/...). Можно также задать в filters.yaml
  TG_CHANNELS: list,
  TG_FETCH_LIMIT: z.coerce.number().int().min(1).max(200).default(50),

  // LLM: любой OpenAI-совместимый endpoint (OpenRouter, DeepSeek, локальный Ollama, прокси и т.д.)
  LLM_ENABLED: bool.default('true'),
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('deepseek/deepseek-chat'),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(60000),
  LLM_MAX_PER_RUN: z.coerce.number().int().min(1).default(30),

  // Бот
  BOT_TOKEN: z.string().min(1),
  // Ваш chat id: узнать через /start в боте. Пока пусто, бот только отвечает на /start
  BOT_OWNER_CHAT_ID: z.coerce.number().int().optional(),

  // Минимальная ставка ₽/час. Заказы с оценкой ниже не присылаются (если NOTIFY_BELOW_MIN_RATE=false)
  MIN_RATE_RUB: z.coerce.number().int().min(0).default(800),
  NOTIFY_BELOW_MIN_RATE: bool.default('false'),
  // Присылать ли заказы, где LLM ответил fit=no
  NOTIFY_REJECTED: bool.default('false'),
  // Не присылать заказы старше N часов (защита от лавины при первом запуске)
  MAX_ORDER_AGE_HOURS: z.coerce.number().int().min(1).default(48),
  // Сколько сбоев источника подряд до предупреждения в бота
  SOURCE_ALERT_AFTER_FAILURES: z.coerce.number().int().min(1).default(3),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ошибка конфигурации (.env):\n${msg}`);
  }
  return parsed.data;
}
