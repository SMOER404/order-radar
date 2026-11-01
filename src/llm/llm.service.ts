import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ENV, FILTERS } from '../config/config.module';
import { Env } from '../config/env';
import { Filters } from '../config/filters';
import { truncate } from '../common/text';
import { createProxyAgent, postJson } from '../common/proxy';

export const scoreSchema = z.object({
  fit: z.enum(['yes', 'maybe', 'no']),
  reason: z.string().default(''),
  estHours: z.coerce.number().positive().max(2000).nullable().catch(null),
  budgetRub: z.coerce.number().positive().nullable().catch(null),
  redFlags: z.array(z.string()).default([]),
  draft: z.string().default(''),
});
export type Score = z.infer<typeof scoreSchema>;

export interface ScoreInput {
  source: string;
  title: string;
  description: string;
  budgetText?: string | null;
  budgetRub?: number | null;
  nicheTags: string[];
}

/** Оценка заказа через OpenAI-совместимый Chat Completions API (OpenRouter, DeepSeek, Ollama, прокси) */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private readonly agent;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(FILTERS) private readonly filters: Filters,
  ) {
    this.agent = env.LLM_USE_PROXY ? createProxyAgent(env.PROXY_URL) : undefined;
  }

  enabled() {
    return this.env.LLM_ENABLED && !!this.env.LLM_API_KEY;
  }

  buildMessages(input: ScoreInput) {
    const system = [
      'Ты помогаешь фрилансеру отбирать заказы. Оцени заказ и верни ТОЛЬКО JSON без markdown.',
      'Профиль исполнителя:',
      this.filters.profile.trim(),
      `Минимальная приемлемая ставка: ${this.env.MIN_RATE_RUB} ₽/час (с учётом общения и правок).`,
      '',
      'Формат ответа:',
      '{"fit":"yes|maybe|no","reason":"1–2 предложения почему","estHours":число часов с учётом общения и правок или null,',
      ' "budgetRub":бюджет заказчика в рублях если указан или null,"redFlags":["признаки мошенничества или плохого заказчика"],',
      ' "draft":"черновик отклика"}',
      '',
      'Правила:',
      '- fit=no, если заказ из списка «не беру», вне компетенций или явно невыгоден.',
      '- redFlags: просьба писать в личку/WhatsApp до сделки, предоплата от исполнителя, «тестовое бесплатно»,',
      '  оплата после запуска/за отзыв, нереальные сроки, отсутствие ТЗ, подозрительно высокий бюджет за простую задачу.',
      '- draft: 3–6 предложений по-русски, на «вы», без шаблонных фраз и без «Здравствуйте, меня зовут».',
      '  Первая фраза о задаче клиента. Коротко как будете делать, 1 релевантный опыт, срок, 1 уточняющий вопрос.',
      '  Цену не называй, если бюджет не указан. Не выдумывай кейсы, которых нет в профиле.',
    ].join('\n');
    const user = [
      `Источник: ${input.source}`,
      `Заголовок: ${input.title}`,
      input.budgetText || input.budgetRub ? `Бюджет: ${input.budgetText ?? `${input.budgetRub} ₽`}` : 'Бюджет: не указан',
      input.nicheTags.length ? `Совпадение с нишами исполнителя: ${input.nicheTags.join(', ')}` : '',
      'Описание:',
      truncate(input.description, 6000),
    ]
      .filter(Boolean)
      .join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  async score(input: ScoreInput): Promise<{ score: Score; raw: unknown }> {
    const res = await postJson(
      `${this.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        model: this.env.LLM_MODEL,
        messages: this.buildMessages(input),
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      },
      { Authorization: `Bearer ${this.env.LLM_API_KEY}` },
      { agent: this.agent, timeoutMs: this.env.LLM_TIMEOUT_MS },
    );
    const body = res.text;
    if (res.status < 200 || res.status >= 300) throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body);
    const content: string = json.choices?.[0]?.message?.content ?? '';
    return { score: parseScore(content), raw: { content, usage: json.usage, model: json.model } };
  }
}

export function parseScore(content: string): Score {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`LLM вернул не JSON: ${content.slice(0, 200)}`);
  return scoreSchema.parse(JSON.parse(content.slice(start, end + 1)));
}

export function estimateRate(budgetRub: number | null | undefined, estHours: number | null | undefined) {
  if (!budgetRub || !estHours) return undefined;
  return Math.round(budgetRub / estHours);
}
