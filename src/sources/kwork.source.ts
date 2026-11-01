import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { fetchText } from '../common/http';
import { stripHtml } from '../common/text';
import { OrderSource, RawOrder } from './types';

/**
 * Kwork, биржа проектов. RSS нет, публичного API для биржи нет, страница /projects рендерится на клиенте.
 * Без headless-браузера данные берутся так:
 *  1) POST https://kwork.ru/projects (form: c=<категория>, page=N) с X-Requested-With: XMLHttpRequest —
 *     тот же запрос, которым фронт Kwork подгружает список; отдаёт JSON с массивом wants.
 *  2) Запасной путь: GET https://kwork.ru/projects?c=<категория> и JSON из window.stateData в HTML.
 * Оба пути неофициальные, поэтому разбор максимально терпимый к изменениям, а сбои уходят предупреждением в бота.
 */
@Injectable()
export class KworkSource implements OrderSource {
  readonly name = 'kwork';
  private readonly log = new Logger(KworkSource.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  enabled() {
    return this.env.KWORK_ENABLED;
  }

  async fetch(): Promise<RawOrder[]> {
    const out: RawOrder[] = [];
    for (const c of this.env.KWORK_CATEGORIES) {
      for (let page = 1; page <= this.env.KWORK_PAGES; page++) {
        const wants = await this.fetchPage(c, page);
        out.push(...wants);
        if (wants.length === 0) break;
      }
    }
    return out;
  }

  private async fetchPage(category: string, page: number): Promise<RawOrder[]> {
    let ajaxError: unknown;
    try {
      const body = await fetchText('https://kwork.ru/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `https://kwork.ru/projects?c=${category}`,
          Origin: 'https://kwork.ru',
        },
        body: new URLSearchParams({ c: category, page: String(page) }).toString(),
      });
      const orders = parseKworkJson(JSON.parse(body));
      if (orders.length) return orders;
    } catch (e) {
      ajaxError = e;
    }
    // запасной путь
    const html = await fetchText(`https://kwork.ru/projects?c=${encodeURIComponent(category)}&page=${page}`);
    const orders = parseKworkHtml(html);
    if (!orders.length && ajaxError) {
      this.log.warn(`Kwork: оба способа не дали данных. AJAX: ${String(ajaxError)}`);
    }
    return orders;
  }
}

type Want = Record<string, unknown>;

/** Ищет массив wants в любом месте JSON (структура ответа у Kwork менялась) */
function findWants(node: unknown, depth = 0): Want[] | undefined {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  if (Array.isArray(node)) return undefined;
  const obj = node as Record<string, unknown>;
  for (const key of ['wants', 'projects']) {
    const v = obj[key];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && 'id' in v[0]) return v as Want[];
  }
  for (const v of Object.values(obj)) {
    const found = findWants(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/\s/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export function parseKworkJson(json: unknown): RawOrder[] {
  const wants = findWants(json) ?? [];
  return wants
    .map((w): RawOrder | undefined => {
      const id = str(w.id);
      if (!id) return undefined;
      const priceLimit = num(w.priceLimit) ?? num(w.price_limit);
      const possible = num(w.possiblePriceLimit) ?? num(w.possible_price_limit);
      const budget = Math.max(priceLimit ?? 0, possible ?? 0) || undefined;
      const date = str(w.date_create) ?? str(w.dateCreate) ?? str(w.date_active) ?? str(w.dateView);
      const user = (w.user ?? {}) as Record<string, unknown>;
      const offers = num(w.kwork_count) ?? num(w.offers) ?? num(w.views_dirty);
      return {
        source: 'KWORK',
        externalId: id,
        url: `https://kwork.ru/projects/${id}/view`,
        title: stripHtml(str(w.name) ?? str(w.title) ?? ''),
        description: stripHtml(str(w.description) ?? str(w.desc) ?? ''),
        budgetRub: budget,
        budgetText: priceLimit
          ? `до ${priceLimit} ₽${possible && possible !== priceLimit ? ` (допустимо ${possible} ₽)` : ''}${offers !== undefined ? `, откликов: ${offers}` : ''}`
          : undefined,
        author: str(user.username) ?? str(w.username),
        publishedAt: date ? parseKworkDate(date) : undefined,
      };
    })
    .filter((o): o is RawOrder => !!o && !!o.title);
}

function parseKworkDate(s: string): Date | undefined {
  // "2026-11-01 12:34:56" (МСК) или unix-время
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? `${s.replace(' ', 'T')}+03:00` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseKworkHtml(html: string): RawOrder[] {
  const m = html.match(/window\.stateData\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/);
  if (!m) return [];
  try {
    return parseKworkJson(JSON.parse(m[1]));
  } catch {
    return [];
  }
}
