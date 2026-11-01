import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { ENV, FILTERS } from '../config/config.module';
import { Env } from '../config/env';
import { Filters } from '../config/filters';
import { PrismaService } from '../prisma/prisma.service';
import { parseBudgetRub, truncate } from '../common/text';
import { OrderSource, RawOrder } from './types';
import { gramjsProxy } from '../common/proxy';

/**
 * Telegram-каналы через MTProto (GramJS) от отдельного аккаунта. Только чтение:
 * клиент не вступает в каналы, ничего не отправляет и не помечает прочитанным, а лишь читает историю публичных каналов.
 * Сессия создаётся один раз командой `npm run tg:login` и кладётся в TG_SESSION.
 */
@Injectable()
export class TelegramSource implements OrderSource, OnModuleDestroy {
  readonly name = 'telegram';
  private readonly log = new Logger(TelegramSource.name);
  private client?: TelegramClient;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(FILTERS) private readonly filters: Filters,
    private readonly prisma: PrismaService,
  ) {}

  channels(): string[] {
    const all = [...this.env.TG_CHANNELS, ...this.filters.telegramChannels].map(normalizeChannel).filter(Boolean);
    return [...new Set(all)];
  }

  enabled() {
    return (
      this.env.TG_ENABLED && !!this.env.TG_API_ID && !!this.env.TG_API_HASH && !!this.env.TG_SESSION && this.channels().length > 0
    );
  }

  private async getClient(): Promise<TelegramClient> {
    if (this.client?.connected) return this.client;
    this.client = new TelegramClient(new StringSession(this.env.TG_SESSION), this.env.TG_API_ID!, this.env.TG_API_HASH!, {
      connectionRetries: 3,
      proxy: this.env.TG_USE_PROXY ? gramjsProxy(this.env.PROXY_URL) : undefined,
    });
    this.client.setLogLevel('error' as never);
    await this.client.connect();
    if (!(await this.client.checkAuthorization())) {
      throw new Error('TG_SESSION недействительна: выполните npm run tg:login заново');
    }
    return this.client;
  }

  async fetch(): Promise<RawOrder[]> {
    const client = await this.getClient();
    const out: RawOrder[] = [];
    for (const channel of this.channels()) {
      const key = `telegram:${channel}`;
      try {
        const state = await this.prisma.sourceState.findUnique({ where: { key } });
        const minId = state?.cursor ? Number(state.cursor) : 0;
        const messages = await client.getMessages(channel, { limit: this.env.TG_FETCH_LIMIT, minId });
        let maxId = minId;
        for (const m of messages) {
          if (!(m instanceof Api.Message)) continue;
          maxId = Math.max(maxId, m.id);
          const order = messageToOrder(channel, m.id, m.message ?? '', m.date);
          if (order) out.push(order);
        }
        await this.prisma.sourceState.upsert({
          where: { key },
          create: { key, cursor: String(maxId), lastOkAt: new Date() },
          update: { cursor: String(maxId), lastOkAt: new Date(), failures: 0, lastError: null },
        });
      } catch (e) {
        // один битый канал не должен ломать остальные
        this.log.warn(`Канал ${channel}: ${String(e)}`);
        await this.prisma.sourceState.upsert({
          where: { key },
          create: { key, failures: 1, lastError: String(e).slice(0, 500) },
          update: { failures: { increment: 1 }, lastError: String(e).slice(0, 500) },
        });
      }
    }
    return out;
  }

  async onModuleDestroy() {
    await this.client?.disconnect().catch(() => undefined);
  }
}

export function normalizeChannel(s: string): string {
  const t = s.trim();
  const m = t.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([A-Za-z0-9_]+)/);
  const name = m ? m[1] : t.replace(/^@/, '');
  return name ? `@${name}` : '';
}

export function messageToOrder(channel: string, id: number, text: string, unixDate?: number): RawOrder | undefined {
  const clean = text.trim();
  if (clean.length < 40) return undefined; // реклама, стикеры, «ищу исполнителя» без текста
  const firstLine = clean.split('\n').find((l) => l.trim().length > 0) ?? clean;
  const username = channel.replace(/^@/, '');
  return {
    source: 'TELEGRAM',
    externalId: `${username}:${id}`,
    url: `https://t.me/${username}/${id}`,
    title: truncate(firstLine.trim(), 140),
    description: clean,
    budgetRub: parseBudgetRub(clean),
    author: channel,
    publishedAt: unixDate ? new Date(unixDate * 1000) : undefined,
  };
}
