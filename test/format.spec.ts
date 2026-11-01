import { describe, expect, it } from 'vitest';
import type { Order } from '@prisma/client';
import { formatAge, formatOrder, plural, suggestPrice } from '../src/bot/format';

const now = new Date('2026-11-01T20:00:00Z');
const base: Order = {
  id: 1, source: 'KWORK', externalId: '1', url: 'https://kwork.ru/projects/1/view',
  title: 'Выгрузка данных по API', description: 'Нужна выгрузка данных из ЭлЖур по API. Есть ТЗ.',
  budgetRub: 30000, budgetText: 'до 10000 ₽ (допустимо 30000 ₽)', author: 'Viktoria_00171', offersCount: 11,
  publishedAt: new Date('2026-11-01T18:00:00Z'), fetchedAt: now, contentHash: 'h', status: 'SCORED', filterReason: null,
  nicheTags: [], fit: 'yes', fitReason: 'Интеграция по API, есть ТЗ', summary: 'Выгрузка оценок из ЭлЖур в таблицу',
  estHours: 7, estHoursMin: 6, estHoursMax: 8, estRateRub: 4286, redFlags: ['API закрытый'], questions: ['Формат выгрузки?', 'Разово или по расписанию?'],
  draftReply: 'Здравствуйте! Делал интеграции по API.', llmRaw: null, scoreAttempts: 1, tgMessageId: null, decidedAt: null,
};
const opts = { minRate: 800, targetRate: 1500, now };

describe('карточка заказа', () => {
  it('вердикт, часы и ставка в первой строке, мета с откликами и возрастом', () => {
    const lines = formatOrder(base, opts).split('\n');
    expect(lines[0]).toBe('🟢 Брать · ≈6–8 ч · ≈4 286 ₽/ч');
    expect(lines[1]).toBe('<b>Выгрузка данных по API</b>');
    expect(lines[2]).toBe('<i>Kwork · Viktoria_00171 · 11 откликов · 2 ч назад</i>');
    expect(lines[3]).toBe('💰 до 10000 ₽ (допустимо 30000 ₽)');
    const text = lines.join('\n');
    expect(text).toContain('<b>Суть:</b> Выгрузка оценок из ЭлЖур в таблицу');
    expect(text).toContain('❓ <b>Уточнить:</b> Формат выгрузки?; Разово или по расписанию?');
    expect(text).toContain('🚩 <b>Риски:</b> API закрытый');
    expect(text).toContain('Черновик отклика');
  });
  it('без оценки — явная пометка и причина', () => {
    const text = formatOrder({ ...base, fit: null, fitReason: 'LLM не ответил', estHours: null, estHoursMin: null, estHoursMax: null, estRateRub: null, summary: null, draftReply: null }, opts);
    expect(text.split('\n')[0]).toBe('⚠️ Без оценки');
    expect(text).toContain('<i>LLM не ответил</i>');
  });
  it('нет бюджета — предлагает цену по желаемой ставке', () => {
    const text = formatOrder({ ...base, budgetRub: null, budgetText: null, estRateRub: null }, opts);
    expect(text).toContain('💰 не указан · предложить ≈12 000 ₽');
  });
  it('цена округляется до 500 ₽ и не меньше 500', () => {
    expect(suggestPrice({ budgetRub: null, estHoursMax: 3.3, estHours: 3 }, 1500)).toBe(5000);
    expect(suggestPrice({ budgetRub: null, estHoursMax: 0.1, estHours: null }, 1500)).toBe(500);
    expect(suggestPrice({ budgetRub: 1000, estHoursMax: 5, estHours: 5 }, 1500)).toBeUndefined();
  });
  it('склонения и возраст', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'отклик', 'отклика', 'откликов'))).toEqual(['отклик', 'отклика', 'откликов', 'откликов', 'отклик', 'отклика']);
    expect(formatAge(new Date('2026-11-01T19:45:00Z'), now)).toBe('15 мин назад');
    expect(formatAge(new Date('2026-10-29T20:00:00Z'), now)).toBe('3 дня назад');
  });
  it('экранирует HTML из текста заказа', () => {
    expect(formatOrder({ ...base, title: '<script>x</script>' }, opts)).toContain('&lt;script&gt;');
  });
});
