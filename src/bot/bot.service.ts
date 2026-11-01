import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Bot, InlineKeyboard } from 'grammy';
import { Order } from '@prisma/client';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { formatOrder } from './format';
import { createProxyAgent } from '../common/proxy';

/** Бот только уведомляет. Кнопки «интересно / мимо» сохраняют решение в БД. Никаких автооткликов. */
@Injectable()
export class BotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(BotService.name);
  readonly bot: Bot;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {
    const agent = env.BOT_USE_PROXY ? createProxyAgent(env.PROXY_URL) : undefined;
    this.bot = new Bot(env.BOT_TOKEN, {
      client: {
        ...(env.BOT_API_ROOT ? { apiRoot: env.BOT_API_ROOT.replace(/\/$/, '') } : {}),
        ...(agent ? { baseFetchConfig: { agent, compress: true } } : {}),
      },
    });
    this.setup();
  }

  private isOwner(chatId?: number) {
    return !!this.env.BOT_OWNER_CHAT_ID && chatId === this.env.BOT_OWNER_CHAT_ID;
  }

  private setup() {
    const bot = this.bot;

    bot.command('start', async (ctx) => {
      if (!this.env.BOT_OWNER_CHAT_ID) {
        await ctx.reply(`Ваш chat id: <code>${ctx.chat.id}</code>\nПропишите его в BOT_OWNER_CHAT_ID и перезапустите контейнер.`, {
          parse_mode: 'HTML',
        });
        return;
      }
      if (!this.isOwner(ctx.chat.id)) return; // чужим не отвечаем
      await ctx.reply('Бот работает. Команды: /stats — статистика, /interesting — последние «интересно».');
    });

    bot.command('stats', async (ctx) => {
      if (!this.isOwner(ctx.chat.id)) return;
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const rows = await this.prisma.order.groupBy({ by: ['status'], where: { fetchedAt: { gte: since } }, _count: true });
      const bySource = await this.prisma.order.groupBy({ by: ['source'], where: { fetchedAt: { gte: since } }, _count: true });
      const states = await this.prisma.sourceState.findMany({ where: { failures: { gt: 0 } } });
      const text = [
        '<b>За 24 часа</b>',
        ...bySource.map((r) => `${r.source}: ${r._count}`),
        '',
        ...rows.map((r) => `${r.status}: ${r._count}`),
        states.length ? `\n⚠️ Сбои: ${states.map((s) => `${s.key} (${s.failures})`).join(', ')}` : '',
      ].join('\n');
      await ctx.reply(text || 'Пока пусто', { parse_mode: 'HTML' });
    });

    bot.command('interesting', async (ctx) => {
      if (!this.isOwner(ctx.chat.id)) return;
      const list = await this.prisma.order.findMany({ where: { status: 'INTERESTING' }, orderBy: { decidedAt: 'desc' }, take: 10 });
      if (!list.length) return void (await ctx.reply('Пока ничего'));
      await ctx.reply(list.map((o) => `• <a href="${o.url}">${o.title.slice(0, 80)}</a>`).join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    });

    bot.callbackQuery(/^(i|s):(\d+)$/, async (ctx) => {
      if (!this.isOwner(ctx.chat?.id)) return ctx.answerCallbackQuery();
      const [, action, idStr] = ctx.match!;
      const status = action === 'i' ? 'INTERESTING' : 'SKIPPED';
      await this.prisma.order.update({ where: { id: Number(idStr) }, data: { status, decidedAt: new Date() } });
      await ctx.answerCallbackQuery({ text: action === 'i' ? 'Сохранил в «интересно»' : 'Мимо' });
      const mark = new InlineKeyboard().text(action === 'i' ? '✅ Интересно' : '➖ Мимо', 'noop');
      await ctx.editMessageReplyMarkup({ reply_markup: mark }).catch(() => undefined);
    });
    bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

    bot.catch((err) => this.log.error(`Ошибка бота: ${String(err.error)}`));
  }

  async onApplicationBootstrap() {
    // long polling, чтобы не нужен был домен и HTTPS для вебхука
    this.bot
      .start({ drop_pending_updates: true, onStart: (me) => this.log.log(`Бот @${me.username} запущен`) })
      .catch((e) => this.log.error(`Бот не запустился (проверьте BOT_TOKEN): ${String(e)}`));
  }

  async onModuleDestroy() {
    if (this.bot.isRunning()) await this.bot.stop().catch(() => undefined);
  }

  canNotify() {
    return !!this.env.BOT_OWNER_CHAT_ID;
  }

  async sendOrder(o: Order): Promise<number> {
    const kb = new InlineKeyboard().text('👍 Интересно', `i:${o.id}`).text('👎 Мимо', `s:${o.id}`);
    const msg = await this.bot.api.sendMessage(this.env.BOT_OWNER_CHAT_ID!, formatOrder(o, this.env.MIN_RATE_RUB), {
      parse_mode: 'HTML',
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
    return msg.message_id;
  }

  async alert(text: string) {
    if (!this.canNotify()) return;
    await this.bot.api.sendMessage(this.env.BOT_OWNER_CHAT_ID!, `⚠️ ${text}`).catch((e) => this.log.error(String(e)));
  }
}
