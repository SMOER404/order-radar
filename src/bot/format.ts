import { Order } from '@prisma/client';
import { escapeHtml, truncate } from '../common/text';

const SOURCE_LABEL: Record<string, string> = { FL: 'FL.ru', KWORK: 'Kwork', TELEGRAM: 'Telegram' };
const VERDICT: Record<string, string> = { yes: '🟢 Брать', maybe: '🟡 Возможно', no: '🔴 Мимо' };
const NICHE_LABEL: Record<string, string> = {
  editor: 'редактор', esign: 'ЭЦП', cabinet: 'личный кабинет', microfrontends: 'микрофронтенды', tables: 'таблицы',
};

export interface FormatOptions {
  minRate: number;
  targetRate: number;
  now?: Date;
}

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function formatAge(published: Date | null, now = new Date()): string | undefined {
  if (!published) return undefined;
  const min = Math.max(0, Math.round((now.getTime() - published.getTime()) / 60000));
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

/** Цена для отклика, если бюджет не указан: реалистичные часы × желаемая ставка, округлено до 500 ₽ */
export function suggestPrice(o: Pick<Order, 'budgetRub' | 'estHoursMax' | 'estHours'>, targetRate: number) {
  const h = o.estHoursMax ?? o.estHours;
  if (o.budgetRub || !h || !targetRate) return undefined;
  return Math.max(500, Math.round((h * targetRate) / 500) * 500);
}

export function formatOrder(o: Order, opts: FormatOptions): string {
  const L: string[] = [];

  // 1. Вердикт, часы, ставка
  const head: string[] = [];
  if (o.fit) head.push(VERDICT[o.fit] ?? o.fit);
  else head.push('⚠️ Без оценки');
  if (o.estHoursMin && o.estHoursMax) {
    head.push(o.estHoursMin === o.estHoursMax ? `≈${hrs(o.estHoursMin)} ч` : `≈${hrs(o.estHoursMin)}–${hrs(o.estHoursMax)} ч`);
  } else if (o.estHours) head.push(`≈${hrs(o.estHours)} ч`);
  if (o.estRateRub) head.push(`≈${rub(o.estRateRub)}/ч${o.estRateRub < opts.minRate ? ' ⚠️' : ''}`);
  if (o.nicheTags.length) head.push(`⭐ ${o.nicheTags.map((t) => NICHE_LABEL[t] ?? t).join(', ')}`);
  L.push(head.join(' · '));

  // 2. Заголовок и мета
  L.push(`<b>${escapeHtml(truncate(o.title, 200))}</b>`);
  const meta = [
    SOURCE_LABEL[o.source] ?? o.source,
    o.author ? escapeHtml(o.author) : null,
    o.offersCount !== null && o.offersCount !== undefined ? `${o.offersCount} ${plural(o.offersCount, 'отклик', 'отклика', 'откликов')}` : null,
    formatAge(o.publishedAt, opts.now),
  ].filter(Boolean);
  L.push(`<i>${meta.join(' · ')}</i>`);

  // 3. Деньги
  const price = suggestPrice(o, opts.targetRate);
  if (o.budgetText) L.push(`💰 ${escapeHtml(o.budgetText)}`);
  else if (o.budgetRub) L.push(`💰 ${rub(o.budgetRub)}`);
  else L.push(`💰 не указан${price ? ` · предложить ≈${rub(price)}` : ''}`);

  // 4. Оценка
  L.push('');
  if (o.fit) {
    if (o.summary) L.push(`<b>Суть:</b> ${escapeHtml(o.summary)}`);
    if (o.fitReason) L.push(`<b>Почему:</b> ${escapeHtml(o.fitReason)}`);
    if (o.questions.length) L.push(`❓ <b>Уточнить:</b> ${escapeHtml(o.questions.join('; '))}`);
    if (o.redFlags.length) L.push(`🚩 <b>Риски:</b> ${escapeHtml(o.redFlags.join('; '))}`);
    L.push(`<blockquote expandable>${escapeHtml(truncate(o.description, 700))}</blockquote>`);
  } else {
    if (o.fitReason) L.push(`<i>${escapeHtml(o.fitReason)}</i>`);
    L.push(escapeHtml(truncate(o.description, 1200)));
  }

  // 5. Черновик
  if (o.draftReply) L.push('', '<b>Черновик отклика:</b>', `<blockquote expandable>${escapeHtml(truncate(o.draftReply, 1500))}</blockquote>`);
  L.push(`<a href="${escapeHtml(o.url)}">Открыть заказ</a>`);
  return truncate(L.join('\n'), 4000);
}
