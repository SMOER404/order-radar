import { Order } from '@prisma/client';
import { escapeHtml, truncate } from '../common/text';

const SOURCE_LABEL: Record<string, string> = { FL: 'FL.ru', KWORK: 'Kwork', TELEGRAM: 'Telegram' };
const FIT_LABEL: Record<string, string> = { yes: '✅ подходит', maybe: '🤔 возможно', no: '❌ не подходит' };
const NICHE_LABEL: Record<string, string> = {
  editor: 'редактор', esign: 'ЭЦП', cabinet: 'личный кабинет', microfrontends: 'микрофронтенды', tables: 'таблицы',
};

export function formatOrder(o: Order, minRate: number): string {
  const lines: string[] = [];
  const star = o.nicheTags.length ? '⭐ ' : '';
  lines.push(`${star}<b>${escapeHtml(truncate(o.title, 200))}</b>`);
  const meta = [SOURCE_LABEL[o.source] ?? o.source, o.author ? escapeHtml(o.author) : null].filter(Boolean).join(' · ');
  lines.push(`<i>${meta}</i>`);
  if (o.nicheTags.length) lines.push(`Ниша: ${o.nicheTags.map((t) => NICHE_LABEL[t] ?? t).join(', ')}`);

  const money: string[] = [];
  if (o.budgetText) money.push(`Бюджет: ${escapeHtml(o.budgetText)}`);
  else if (o.budgetRub) money.push(`Бюджет: ${o.budgetRub.toLocaleString('ru-RU')} ₽`);
  else money.push('Бюджет: не указан');
  if (o.estHours) money.push(`≈ ${o.estHours} ч`);
  if (o.estRateRub) money.push(`≈ ${o.estRateRub.toLocaleString('ru-RU')} ₽/ч${o.estRateRub < minRate ? ' ⚠️ ниже минимума' : ''}`);
  lines.push(money.join(' · '));

  if (o.fit) lines.push(`${FIT_LABEL[o.fit] ?? o.fit}${o.fitReason ? `: ${escapeHtml(o.fitReason)}` : ''}`);
  if (o.redFlags.length) lines.push(`🚩 ${escapeHtml(o.redFlags.join('; '))}`);

  lines.push('', escapeHtml(truncate(o.description, 1200)));
  if (o.draftReply) lines.push('', '<b>Черновик отклика:</b>', `<blockquote expandable>${escapeHtml(truncate(o.draftReply, 1500))}</blockquote>`);
  lines.push('', `<a href="${escapeHtml(o.url)}">Открыть заказ</a>`);
  // лимит Telegram 4096 символов
  return truncate(lines.join('\n'), 4000);
}
