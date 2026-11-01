import { Inject, Injectable } from '@nestjs/common';
import Parser from 'rss-parser';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { fetchText } from '../common/http';
import { parseBudgetRub, stripHtml } from '../common/text';
import { OrderSource, RawOrder } from './types';

/** FL.ru: официальный RSS по категориям, без авторизации */
@Injectable()
export class FlSource implements OrderSource {
  readonly name = 'fl';
  private readonly parser = new Parser();

  constructor(@Inject(ENV) private readonly env: Env) {}

  enabled() {
    return this.env.FL_ENABLED && this.env.FL_RSS_URLS.length > 0;
  }

  async fetch(): Promise<RawOrder[]> {
    const out: RawOrder[] = [];
    for (const url of this.env.FL_RSS_URLS) {
      const xml = await fetchText(url, { headers: { Accept: 'application/rss+xml, application/xml' } });
      out.push(...(await parseFlRss(xml, this.parser)));
    }
    return out;
  }
}

export async function parseFlRss(xml: string, parser = new Parser()): Promise<RawOrder[]> {
  const feed = await parser.parseString(xml);
  const orders: RawOrder[] = [];
  for (const item of feed.items) {
    const link = item.link ?? item.guid ?? '';
    const id = link.match(/projects\/(\d+)/)?.[1] ?? item.guid ?? link;
    if (!id) continue;
    const rawTitle = stripHtml(item.title ?? '');
    // FL пишет бюджет в заголовке: «Сделать лендинг (Бюджет: 15000 ₽)»
    const budgetMatch = rawTitle.match(/\((?:бюджет|budget)[:\s]*([^)]*)\)\s*$/i);
    const title = budgetMatch ? rawTitle.slice(0, budgetMatch.index).trim() : rawTitle;
    const description = stripHtml(item.content ?? item.contentSnippet ?? item.summary ?? '');
    const budgetText = budgetMatch?.[1]?.trim();
    orders.push({
      source: 'FL',
      externalId: String(id),
      url: link,
      title,
      description,
      budgetText,
      budgetRub: budgetText ? parseBudgetRub(`${budgetText} руб`) : parseBudgetRub(description),
      author: item.categories?.join(', ') || undefined,
      publishedAt: item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : undefined,
    });
  }
  return orders;
}
