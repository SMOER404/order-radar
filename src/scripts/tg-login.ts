/**
 * Одноразовый вход в Telegram для чтения каналов. Запуск:
 *   docker compose run --rm app npm run tg:login   (или без Docker: npm run tg:login)
 * Нужны TG_API_ID и TG_API_HASH (https://my.telegram.org → API development tools).
 * Лучше отдельный аккаунт, не основной. Выведенную строку положите в TG_SESSION в .env.
 */
import { createInterface } from 'node:readline/promises';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { gramjsProxy } from '../common/proxy';

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) throw new Error('Задайте TG_API_ID и TG_API_HASH в .env');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
    proxy: process.env.TG_USE_PROXY === 'false' ? undefined : gramjsProxy(process.env.PROXY_URL || undefined),
  });
  await client.start({
    phoneNumber: () => rl.question('Телефон (+7...): '),
    phoneCode: () => rl.question('Код из Telegram: '),
    password: () => rl.question('Пароль 2FA (если есть): '),
    onError: (e) => console.error(e),
  });
  console.log('\nTG_SESSION=' + (client.session.save() as unknown as string));
  console.log('\nСкопируйте строку выше в .env. Никому её не показывайте: это полный доступ к аккаунту.');
  rl.close();
  await client.disconnect();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
