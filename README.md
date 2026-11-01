# order-radar

Собирает заказы с FL.ru, Kwork и Telegram-каналов, отсеивает мусор, оценивает через LLM
(подходит ли, сколько часов, сколько выйдет ₽/час, черновик отклика) и присылает в Telegram-бота
с кнопками «👍 Интересно / 👎 Мимо». Бот только уведомляет: откликаетесь вы сами.

## Как устроено

```
каждые COLLECT_INTERVAL_MIN минут
  ├─ сбор: FL.ru RSS · Kwork · Telegram-каналы (только чтение)
  ├─ дедупликация в Postgres: (источник, id) + хеш текста (один заказ из FL и из TG-канала = один)
  ├─ фильтр: стоп-слова → ключевые слова → свежесть; ниши помечаются ⭐ и проходят всегда
  ├─ LLM-оценка (OpenAI-совместимый API): fit, часы, бюджет, красные флаги, черновик
  ├─ решение: fit=no или ставка < MIN_RATE_RUB → не шлём (ниши шлём всё равно, с ⚠️)
  └─ бот: карточка заказа + кнопки, решение пишется в БД
```

Статусы заказа в таблице `Order`: `NEW → FILTERED_OUT | PASSED → SCORED (ERROR, до 3 попыток) → REJECTED | NOTIFIED → INTERESTING | SKIPPED`.
Каждый шаг берёт заказы по статусу, поэтому после рестарта всё продолжается с того же места.

| Папка | Что там |
|---|---|
| `src/sources` | источники: `fl.source.ts`, `kwork.source.ts`, `telegram.source.ts` |
| `src/pipeline` | конвейер и фильтры |
| `src/llm` | промпт и разбор ответа LLM |
| `src/bot` | grammY-бот и формат карточки |
| `config/filters.yaml` | стоп-слова, ключевые слова, ниши, TG-каналы, ваш профиль для LLM |
| `prisma/` | схема БД и миграции |

### Откуда берутся данные

- **FL.ru**: официальный RSS (`FL_RSS_URLS`, можно несколько лент через запятую). Бюджет из заголовка «(Бюджет: …)».
- **Kwork**: RSS и публичного API у биржи нет, страница `/projects` рисуется на клиенте. Без headless-браузера
  берём тот же JSON, что подгружает сам сайт: `POST https://kwork.ru/projects` (`c=<категория>&page=N`,
  заголовок `X-Requested-With: XMLHttpRequest`). Если не вышло, запасной путь: JSON из `window.stateData` в HTML страницы.
  Способ неофициальный и может сломаться; тогда после `SOURCE_ALERT_AFTER_FAILURES` сбоев подряд бот пришлёт предупреждение.
  Проверить вручную: `docker compose run --rm app npm run collect:once`.
- **Telegram**: GramJS (MTProto) от **отдельного** аккаунта. Читает историю публичных каналов, не вступает в них,
  ничего не пишет. Курсор (последний id сообщения) хранится в `SourceState`, повторно ничего не читается.

## Деплой на VPS

Нужно: Linux VPS (хватит 1 vCPU / 1 ГБ), Docker с плагином compose. Порты наружу не нужны: бот работает через long polling.

```bash
git clone git@github.com:<you>/order-radar.git && cd order-radar
cp .env.example .env
nano .env                      # BOT_TOKEN, LLM_API_KEY, POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs -f app
```

1. Создайте бота у @BotFather, токен в `BOT_TOKEN`.
2. Напишите боту `/start`: он ответит вашим chat id. Впишите его в `BOT_OWNER_CHAT_ID`, затем `docker compose up -d`.
   Бот отвечает только этому чату.
3. LLM: любой OpenAI-совместимый сервис. По умолчанию OpenRouter + `deepseek/deepseek-chat` (дёшево, работает из РФ
   с оплатой криптой/через посредников). Можно DeepSeek напрямую (`LLM_BASE_URL=https://api.deepseek.com/v1`,
   `LLM_MODEL=deepseek-chat`) или локальную модель через Ollama (`http://host.docker.internal:11434/v1`).
   Без ключа LLM заказы приходят без оценки.

Обновление: `git pull && docker compose up -d --build`. Миграции применяются автоматически при старте.

### Telegram-каналы

```bash
# в .env: TG_API_ID, TG_API_HASH с https://my.telegram.org (API development tools)
docker compose run --rm app npm run tg:login   # телефон, код, 2FA → строка TG_SESSION
# в .env: TG_SESSION=..., TG_ENABLED=true, TG_CHANNELS=@канал1,@канал2
docker compose up -d
```
TG_SESSION даёт полный доступ к аккаунту: не коммитьте и никому не показывайте.

### Настройка фильтров

`config/filters.yaml` смонтирован в контейнер: правите на сервере и делаете `docker compose restart app`.
Слова ищутся по подстроке без учёта регистра, знаки препинания игнорируются. Пробел в слове значим:
`" js "` — только отдельное слово js (не json), `" лк "` — отдельное слово «лк».

## Команды бота

- `/start` — chat id (при первой настройке) или проверка, что бот жив
- `/stats` — сколько заказов за сутки по источникам и статусам, сбои источников
- `/interesting` — последние 10 заказов с «интересно»

## Разработка

```bash
npm ci
npx prisma generate
npm test                       # юнит-тесты на фикстурах
# интеграционный тест конвейера на живом Postgres:
TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy  # с DATABASE_URL=$TEST_DATABASE_URL
TEST_DATABASE_URL=postgresql://... npm test
npm run build && npm start
```

Полезные запросы к БД (`docker compose exec db psql -U radar radar`):

```sql
-- почему отсеялось
select status, "filterReason", count(*) from "Order" group by 1,2 order by 3 desc;
-- что понравилось
select title, "estRateRub", url from "Order" where status = 'INTERESTING' order by "decidedAt" desc;
```

## Открытые вопросы (вынесены в конфиг)

- `MIN_RATE_RUB` — минимальная ставка, по умолчанию 800 ₽/ч.
- `TG_CHANNELS` / `telegramChannels` — список каналов пуст.
- `KWORK_CATEGORIES` — по умолчанию 11 («Разработка и IT»), проверьте номер в адресе страницы биржи.
