/**
 * Проверка источников без БД и бота: печатает, что удалось собрать и как сработали фильтры.
 *   docker compose run --rm app npm run collect:once
 */
import { loadEnv } from '../config/env';
import { loadFilters } from '../config/filters';
import { FlSource } from '../sources/fl.source';
import { KworkSource } from '../sources/kwork.source';
import { applyFilters } from '../pipeline/filter';

async function main() {
  const env = loadEnv({ BOT_TOKEN: 'dry-run', DATABASE_URL: 'dry-run', ...process.env });
  const filters = loadFilters(env.FILTERS_PATH);
  for (const src of [new FlSource(env), new KworkSource(env)]) {
    try {
      const orders = await src.fetch();
      console.log(`\n=== ${src.name}: ${orders.length} заказов`);
      for (const o of orders.slice(0, 15)) {
        const f = applyFilters(o.title, o.description, filters);
        console.log(`${f.pass ? '✓' : '✗'} [${o.budgetRub ?? '—'} ₽] ${o.title.slice(0, 90)}${f.reason ? `  (${f.reason})` : ''}${f.nicheTags.length ? ` ⭐${f.nicheTags}` : ''}`);
      }
    } catch (e) {
      console.log(`\n=== ${src.name}: ОШИБКА ${String(e)}`);
    }
  }
}
main();
