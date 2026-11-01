import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV, FILTERS } from '../config/config.module';
import { Env } from '../config/env';
import { Filters } from '../config/filters';
import { PrismaService } from '../prisma/prisma.service';
import { ORDER_SOURCES } from '../sources/sources.module';
import { OrderSource, RawOrder } from '../sources/types';
import { LlmService, estimateRate } from '../llm/llm.service';
import { BotService } from '../bot/bot.service';
import { contentHash } from '../common/text';
import { applyFilters } from './filter';

const MAX_SCORE_ATTEMPTS = 3;

/**
 * Конвейер: сбор → дедупликация → стоп-слова/ключевые слова → LLM-оценка → уведомление.
 * Каждый шаг берёт заказы из БД по статусу, поэтому после падения или рестарта всё продолжается с того же места.
 */
@Injectable()
export class PipelineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PipelineService.name);
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(FILTERS) private readonly filters: Filters,
    @Inject(ORDER_SOURCES) private readonly sources: OrderSource[],
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly bot: BotService,
  ) {}

  onApplicationBootstrap() {
    const ms = this.env.COLLECT_INTERVAL_MIN * 60_000;
    this.log.log(
      `Интервал сбора ${this.env.COLLECT_INTERVAL_MIN} мин. Источники: ${this.sources.map((s) => `${s.name}=${s.enabled() ? 'вкл' : 'выкл'}`).join(', ')}. LLM: ${this.llm.enabled() ? this.env.LLM_MODEL : 'выкл'}`,
    );
    setTimeout(() => void this.run(), 5_000); // первый прогон сразу после старта
    this.timer = setInterval(() => void this.run(), ms);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return void this.log.warn('Предыдущий прогон ещё идёт, пропускаю');
    this.running = true;
    const started = Date.now();
    try {
      const created = await this.collect();
      const filtered = await this.filter();
      const scored = await this.score();
      const sent = await this.notify();
      this.log.log(`Прогон: новых ${created}, прошли фильтр ${filtered}, оценено ${scored}, отправлено ${sent} (${Date.now() - started} мс)`);
    } catch (e) {
      this.log.error(`Прогон упал: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }

  // 1. Сбор и дедупликация
  async collect(): Promise<number> {
    let total = 0;
    for (const source of this.sources) {
      if (!source.enabled()) continue;
      try {
        const raw = await source.fetch();
        total += await this.save(raw);
        await this.markSource(source.name, null);
      } catch (e) {
        this.log.warn(`Источник ${source.name}: ${String(e)}`);
        await this.markSource(source.name, e);
      }
    }
    return total;
  }

  async save(raw: RawOrder[]): Promise<number> {
    if (!raw.length) return 0;
    const data: Prisma.OrderCreateManyInput[] = raw.map((r) => ({
      ...r,
      title: r.title.slice(0, 500),
      contentHash: contentHash(r.title, r.description),
    }));
    // уникальность (source, externalId) — первый уровень дедупликации
    const created = await this.prisma.order.createManyAndReturn({ data, skipDuplicates: true, select: { id: true, contentHash: true } });
    // второй уровень: тот же текст уже приходил из другого источника/канала
    for (const o of created) {
      const dup = await this.prisma.order.findFirst({
        where: { contentHash: o.contentHash, id: { lt: o.id } },
        select: { id: true },
      });
      if (dup) {
        await this.prisma.order.update({ where: { id: o.id }, data: { status: 'FILTERED_OUT', filterReason: `дубликат #${dup.id}` } });
      }
    }
    return created.length;
  }

  private async markSource(key: string, error: unknown) {
    if (!error) {
      const prev = await this.prisma.sourceState.findUnique({ where: { key } });
      if (prev?.alertedAt) await this.bot.alert(`Источник ${key} снова работает`);
      await this.prisma.sourceState.upsert({
        where: { key },
        create: { key, lastOkAt: new Date() },
        update: { failures: 0, lastError: null, lastOkAt: new Date(), alertedAt: null },
      });
      return;
    }
    const msg = String(error).slice(0, 500);
    const st = await this.prisma.sourceState.upsert({
      where: { key },
      create: { key, failures: 1, lastError: msg },
      update: { failures: { increment: 1 }, lastError: msg },
    });
    if (st.failures >= this.env.SOURCE_ALERT_AFTER_FAILURES && !st.alertedAt) {
      await this.bot.alert(`Источник ${key} не отвечает ${st.failures} раз подряд: ${msg.slice(0, 300)}`);
      await this.prisma.sourceState.update({ where: { key }, data: { alertedAt: new Date() } });
    }
  }

  // 2. Стоп-слова, ключевые слова, возраст
  async filter(): Promise<number> {
    const orders = await this.prisma.order.findMany({ where: { status: 'NEW' }, take: 1000 });
    const minDate = Date.now() - this.env.MAX_ORDER_AGE_HOURS * 3600_000;
    let passed = 0;
    for (const o of orders) {
      const r = applyFilters(o.title, o.description, this.filters);
      let reason = r.reason;
      if (!reason && o.publishedAt && o.publishedAt.getTime() < minDate) reason = 'старый заказ';
      await this.prisma.order.update({
        where: { id: o.id },
        data: { status: reason ? 'FILTERED_OUT' : 'PASSED', filterReason: reason ?? null, nicheTags: r.nicheTags },
      });
      if (!reason) passed++;
    }
    return passed;
  }

  // 3. Оценка LLM
  async score(): Promise<number> {
    if (!this.llm.enabled()) {
      const { count } = await this.prisma.order.updateMany({ where: { status: 'PASSED' }, data: { status: 'SCORED' } });
      return count;
    }
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ status: 'PASSED' }, { status: 'ERROR', scoreAttempts: { lt: MAX_SCORE_ATTEMPTS } }] },
      // ниши первыми
      orderBy: [{ fetchedAt: 'desc' }],
      take: this.env.LLM_MAX_PER_RUN,
    });
    orders.sort((a, b) => b.nicheTags.length - a.nicheTags.length);
    let ok = 0;
    for (const o of orders) {
      try {
        const { score, raw } = await this.llm.score(o);
        const budget = o.budgetRub ?? (score.budgetRub ? Math.round(score.budgetRub) : null);
        await this.prisma.order.update({
          where: { id: o.id },
          data: {
            status: 'SCORED',
            fit: score.fit,
            fitReason: score.reason,
            summary: score.summary || null,
            estHours: score.estHours,
            estHoursMin: score.estHoursMin,
            estHoursMax: score.estHoursMax,
            questions: score.questions.slice(0, 3),
            budgetRub: budget,
            estRateRub: estimateRate(budget, score.estHours) ?? null,
            redFlags: score.redFlags,
            draftReply: score.draft,
            llmRaw: raw as Prisma.InputJsonValue,
            scoreAttempts: { increment: 1 },
          },
        });
        ok++;
      } catch (e) {
        this.log.warn(`LLM, заказ #${o.id}: ${String(e)}`);
        const attempts = o.scoreAttempts + 1;
        await this.prisma.order.update({
          where: { id: o.id },
          // после последней попытки всё равно отправим, но без оценки
          data: { status: attempts >= MAX_SCORE_ATTEMPTS ? 'SCORED' : 'ERROR', scoreAttempts: attempts, fitReason: attempts >= MAX_SCORE_ATTEMPTS ? 'LLM не ответил' : null },
        });
      }
    }
    return ok;
  }

  // 4. Уведомления
  async notify(): Promise<number> {
    if (!this.bot.canNotify()) return 0;
    const orders = await this.prisma.order.findMany({ where: { status: 'SCORED' }, orderBy: { id: 'asc' }, take: 50 });
    let sent = 0;
    for (const o of orders) {
      const decision = shouldNotify(o, this.env);
      if (!decision.notify) {
        await this.prisma.order.update({ where: { id: o.id }, data: { status: 'REJECTED', filterReason: decision.reason } });
        continue;
      }
      try {
        const messageId = await this.bot.sendOrder(o);
        await this.prisma.order.update({ where: { id: o.id }, data: { status: 'NOTIFIED', tgMessageId: messageId } });
        sent++;
        await new Promise((r) => setTimeout(r, 1100)); // лимит Telegram ~1 сообщение/сек в один чат
      } catch (e) {
        this.log.warn(`Отправка #${o.id}: ${String(e)}`);
      }
    }
    return sent;
  }
}

export function shouldNotify(
  o: { fit: string | null; estRateRub: number | null; nicheTags: string[] },
  env: Pick<Env, 'NOTIFY_REJECTED' | 'NOTIFY_BELOW_MIN_RATE' | 'MIN_RATE_RUB'>,
): { notify: boolean; reason?: string } {
  if (o.fit === 'no' && !env.NOTIFY_REJECTED) return { notify: false, reason: 'LLM: не подходит' };
  // свои ниши присылаем даже при низкой оценке ставки — там можно торговаться
  if (o.estRateRub !== null && o.estRateRub < env.MIN_RATE_RUB && !env.NOTIFY_BELOW_MIN_RATE && o.nicheTags.length === 0) {
    return { notify: false, reason: `ставка ≈${o.estRateRub} ₽/ч ниже минимума` };
  }
  return { notify: true };
}
