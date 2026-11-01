/**
 * Интеграционный тест конвейера на живом Postgres. Запуск:
 *   TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy && TEST_DATABASE_URL=... npm test
 * Без TEST_DATABASE_URL пропускается.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { loadEnv } from '../src/config/env';
import { loadFilters } from '../src/config/filters';
import { scoreSchema } from '../src/llm/llm.service';
import type { OrderSource, RawOrder } from '../src/sources/types';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('конвейер (Postgres)', () => {
  let prisma: PrismaService;
  const sent: number[] = [];
  const alerts: string[] = [];
  let failKwork = false;

  const now = new Date();
  const fl: RawOrder[] = [
    { source: 'FL', externalId: '1', url: 'u1', title: 'Телеграм-бот для записи', description: 'Нужен бот на Node.js для записи клиентов, бюджет 12000 руб', budgetRub: 12000, publishedAt: now },
    { source: 'FL', externalId: '2', url: 'u2', title: 'Сайт за отзыв', description: 'Сделать сайт на WordPress, работа за отзыв, без оплаты', publishedAt: now },
    { source: 'FL', externalId: '3', url: 'u3', title: 'Редактор на Tiptap', description: 'Встроить Tiptap-редактор в админку, бюджет 40000 руб', budgetRub: 40000, publishedAt: now },
  ];
  // тот же заказ, что FL #1, пришёл из телеграм-канала
  const tg: RawOrder[] = [
    { source: 'TELEGRAM', externalId: 'ch:5', url: 'u5', title: 'Телеграм-бот для записи', description: 'Нужен бот на Node.js для записи клиентов, бюджет 12000 руб  https://fl.ru/x', publishedAt: now },
  ];
  const sources: OrderSource[] = [
    { name: 'fl', enabled: () => true, fetch: async () => fl },
    { name: 'tg', enabled: () => true, fetch: async () => tg },
    { name: 'kwork', enabled: () => true, fetch: async () => { if (failKwork) throw new Error('HTTP 403'); return []; } },
  ];

  const env = loadEnv({ DATABASE_URL: url ?? 'not-set', BOT_TOKEN: 'x', BOT_OWNER_CHAT_ID: '1', MIN_RATE_RUB: '1000', SOURCE_ALERT_AFTER_FAILURES: '2' });
  const llm = {
    enabled: () => true,
    score: async (o: { title: string }) => ({
      score: scoreSchema.parse(
        o.title.includes('Tiptap')
          ? { fit: 'yes', reason: 'ниша', estHoursMin: 16, estHoursMax: 24, draft: 'Сделаю', questions: ['Сроки?'] }
          : { fit: 'yes', reason: 'бот', estHours: 24, draft: 'Сделаю бота' },
      ),
      raw: {},
    }),
  };
  const bot = {
    canNotify: () => true,
    sendOrder: async (o: { id: number }) => { sent.push(o.id); return 100 + o.id; },
    alert: async (t: string) => { alerts.push(t); },
  };

  let pipeline: PipelineService;

  beforeAll(async () => {
    prisma = new PrismaService({ datasourceUrl: url } as never);
    await prisma.$connect();
    await prisma.order.deleteMany();
    await prisma.sourceState.deleteMany();
    pipeline = new PipelineService(env, loadFilters('config/filters.yaml'), sources, prisma, llm as never, bot as never);
  });
  afterAll(async () => prisma?.$disconnect());

  it('полный прогон', async () => {
    await pipeline.run();
    const orders = await prisma.order.findMany({ orderBy: { id: 'asc' } });
    const by = Object.fromEntries(orders.map((o) => [o.externalId, o]));
    expect(orders).toHaveLength(4);
    expect(by['2'].status).toBe('FILTERED_OUT');
    expect(by['2'].filterReason).toContain('за отзыв');
    expect(by['ch:5'].filterReason).toBe(`дубликат #${by['1'].id}`);
    // 12000 / 24 = 500 ₽/ч < 1000 → не шлём
    expect(by['1']).toMatchObject({ status: 'REJECTED', estRateRub: 500 });
    // ниша: 40000/20 = 2000 → шлём
    expect(by['3']).toMatchObject({ status: 'NOTIFIED', nicheTags: ['editor'], estRateRub: 2000, estHoursMin: 16, estHoursMax: 24, questions: ['Сроки?'], tgMessageId: 100 + by['3'].id });
    expect(sent).toEqual([by['3'].id]);
  });

  it('повторный прогон не создаёт дублей', async () => {
    await pipeline.run();
    expect(await prisma.order.count()).toBe(4);
    expect(sent).toHaveLength(1);
  });

  it('предупреждает о сбоях источника один раз и о восстановлении', async () => {
    failKwork = true;
    await pipeline.run();
    await pipeline.run();
    await pipeline.run();
    expect(alerts.filter((a) => a.includes('kwork') && a.includes('не отвечает'))).toHaveLength(1);
    failKwork = false;
    await pipeline.run();
    expect(alerts.at(-1)).toContain('снова работает');
  });
});
