import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFlRss } from '../src/sources/fl.source';
import { parseKworkHtml, parseKworkJson } from '../src/sources/kwork.source';
import { messageToOrder, normalizeChannel } from '../src/sources/telegram.source';
import { applyFilters } from '../src/pipeline/filter';
import { shouldNotify } from '../src/pipeline/pipeline.service';
import { parseScore, estimateRate } from '../src/llm/llm.service';
import { contentHash, parseBudgetRub } from '../src/common/text';
import { loadFilters } from '../src/config/filters';

const filters = loadFilters('config/filters.yaml');

describe('FL.ru RSS', () => {
  it('разбирает заказы и бюджет из заголовка', async () => {
    const orders = await parseFlRss(readFileSync('test/fixtures/fl.xml', 'utf8'));
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ source: 'FL', externalId: '5512345', title: 'Доработать лендинг на Тильде', budgetRub: 15000 });
    expect(orders[0].description).toContain('amoCRM');
    expect(orders[0].publishedAt?.toISOString()).toBe('2026-11-01T09:10:00.000Z');
  });
});

describe('Kwork', () => {
  const json = JSON.parse(readFileSync('test/fixtures/kwork.json', 'utf8'));
  it('разбирает AJAX-ответ', () => {
    const orders = parseKworkJson(json);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ externalId: '2934811', budgetRub: 45000, author: 'client77', url: 'https://kwork.ru/projects/2934811/view' });
    expect(orders[0].description).toBe('Нужен блочный редактор на Tiptap с таблицами и загрузкой картинок');
    expect(orders[0].publishedAt?.toISOString()).toBe('2026-11-01T08:20:00.000Z');
  });
  it('разбирает window.stateData из HTML', () => {
    const html = `<script>window.stateData = ${JSON.stringify({ wantsListData: json.data })};</script>`;
    expect(parseKworkHtml(html)).toHaveLength(2);
  });
  it('не падает на мусоре', () => {
    expect(parseKworkJson({ success: false })).toEqual([]);
    expect(parseKworkHtml('<html></html>')).toEqual([]);
  });
});

describe('Telegram', () => {
  it('нормализует каналы', () => {
    expect(normalizeChannel('https://t.me/s/freelance_orders')).toBe('@freelance_orders');
    expect(normalizeChannel('freelance_orders')).toBe('@freelance_orders');
  });
  it('превращает сообщение в заказ и отбрасывает короткие', () => {
    const o = messageToOrder('@ch', 42, '#заказ Нужен телеграм-бот на Node\nБюджет 20 тыс руб, срок неделя', 1793000000);
    expect(o).toMatchObject({ externalId: 'ch:42', url: 'https://t.me/ch/42', budgetRub: 20000, title: '#заказ Нужен телеграм-бот на Node' });
    expect(messageToOrder('@ch', 43, 'реклама')).toBeUndefined();
  });
});

describe('фильтры', () => {
  it('стоп-слова', () => {
    const r = applyFilters('Сайт для салона', 'Сделать сайт на WordPress, оплата после запуска', filters);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('оплата после запуска');
  });
  it('ниши проходят и помечаются', () => {
    const r = applyFilters('Подпись документов', 'Встроить подписание через КриптоПро в веб-приложение заказчика', filters);
    expect(r).toMatchObject({ pass: true, nicheTags: ['esign'] });
  });
  it('без ключевых слов отсеивается', () => {
    expect(applyFilters('Нарисовать логотип', 'Нужен логотип для кофейни в минималистичном стиле', filters).reason).toBe('нет ключевых слов');
  });
  it('без описания отсеивается', () => {
    expect(applyFilters('Сайт', '', filters).reason).toBe('нет описания');
  });
  it('пробел в ключевом слове значим: " js" не ловит "json"', () => {
    const f = { ...filters, includeKeywords: [' js '] };
    expect(applyFilters('Конвертер', 'Переложить данные из xml в json формат для выгрузки', f).pass).toBe(false);
    expect(applyFilters('Скрипт', 'Нужен скрипт на js для страницы с калькулятором', f).pass).toBe(true);
  });
});

describe('бюджет и ставка', () => {
  it.each([
    ['Бюджет: 15 000 руб', 15000],
    ['до 5000₽', 5000],
    ['оплата 10к', 10000],
    ['3 тыс. руб', 3000],
    ['от 20000 до 40000 руб', 40000],
    ['без цены', undefined],
  ])('%s → %s', (text, expected) => expect(parseBudgetRub(text)).toBe(expected));

  it('считает ₽/час', () => {
    expect(estimateRate(15000, 10)).toBe(1500);
    expect(estimateRate(null, 10)).toBeUndefined();
  });

  it('решает, слать ли в бота', () => {
    const env = { NOTIFY_REJECTED: false, NOTIFY_BELOW_MIN_RATE: false, MIN_RATE_RUB: 800 };
    expect(shouldNotify({ fit: 'no', estRateRub: 2000, nicheTags: [] }, env).notify).toBe(false);
    expect(shouldNotify({ fit: 'yes', estRateRub: 500, nicheTags: [] }, env).notify).toBe(false);
    expect(shouldNotify({ fit: 'yes', estRateRub: 500, nicheTags: ['editor'] }, env).notify).toBe(true);
    expect(shouldNotify({ fit: 'maybe', estRateRub: null, nicheTags: [] }, env).notify).toBe(true);
  });
});

describe('LLM-ответ', () => {
  it('достаёт JSON даже в ```-обёртке', () => {
    const s = parseScore('```json\n{"fit":"yes","reason":"ок","estHours":"6","budgetRub":null,"redFlags":[],"draft":"Текст"}\n```');
    expect(s).toMatchObject({ fit: 'yes', estHours: 6, draft: 'Текст' });
  });
  it('кривые числа превращает в null', () => {
    expect(parseScore('{"fit":"maybe","estHours":"не знаю"}').estHours).toBeNull();
  });
});

describe('дедупликация', () => {
  it('одинаковый текст с разным форматированием даёт один хеш', () => {
    expect(contentHash('Нужен бот!', 'Сделать бота  https://t.me/x')).toBe(contentHash('нужен бот', 'Сделать бота'));
  });
});
