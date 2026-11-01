import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createProxyAgent, gramjsProxy, postJson } from '../src/common/proxy';
import { loadEnv } from '../src/config/env';

describe('прокси', () => {
  it('создаёт агент по схеме', () => {
    expect(createProxyAgent(undefined)).toBeUndefined();
    expect(createProxyAgent('socks5://u:p@1.2.3.4:1080')?.constructor.name).toBe('SocksProxyAgent');
    expect(createProxyAgent('http://1.2.3.4:3128')?.constructor.name).toBe('HttpsProxyAgent');
    expect(() => createProxyAgent('ftp://x')).toThrow();
  });
  it('параметры для GramJS только для SOCKS', () => {
    expect(gramjsProxy('socks5://u:p%40@h:9050')).toMatchObject({ ip: 'h', port: 9050, socksType: 5, username: 'u', password: 'p@' });
    expect(gramjsProxy('http://h:3128')).toBeUndefined();
  });
  it('пустые значения в .env не ломают конфиг', () => {
    const env = loadEnv({ DATABASE_URL: 'x', BOT_TOKEN: 'x', PROXY_URL: '', BOT_API_ROOT: '', BOT_OWNER_CHAT_ID: '', TG_API_ID: '' });
    expect(env.PROXY_URL).toBeUndefined();
    expect(env.BOT_OWNER_CHAT_ID).toBeUndefined();
  });
  it('пустой обязательный параметр даёт понятную ошибку, пустой необязательный — значение по умолчанию', () => {
    expect(() => loadEnv({ DATABASE_URL: 'x', BOT_TOKEN: '' })).toThrow(/BOT_TOKEN/);
    expect(loadEnv({ DATABASE_URL: 'x', BOT_TOKEN: 'x', MIN_RATE_RUB: '', LLM_MODEL: '' })).toMatchObject({ MIN_RATE_RUB: 800, LLM_MODEL: 'deepseek/deepseek-chat' });
  });
  it('PROXY_URL со списком прокси даёт понятную ошибку', () => {
    expect(() => loadEnv({ DATABASE_URL: 'x', BOT_TOKEN: 'x', PROXY_URL: 'http://a:1,http://b:2' })).toThrow(/один адрес/);
  });
  it('LLM_EXTRA_BODY разбирается как JSON-объект', () => {
    const base = { DATABASE_URL: 'x', BOT_TOKEN: 'x' };
    expect(loadEnv({ ...base, LLM_EXTRA_BODY: '{"thinking":{"type":"disabled"}}' }).LLM_EXTRA_BODY).toEqual({ thinking: { type: 'disabled' } });
    expect(loadEnv(base).LLM_EXTRA_BODY).toEqual({});
    expect(() => loadEnv({ ...base, LLM_EXTRA_BODY: '[1]' })).toThrow(/LLM_EXTRA_BODY/);
  });
  it('postJson отправляет JSON и возвращает ответ', async () => {
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => res.end(JSON.stringify({ got: JSON.parse(b), auth: req.headers.authorization })));
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const port = (srv.address() as { port: number }).port;
    const res = await postJson(`http://127.0.0.1:${port}/x`, { a: 1 }, { Authorization: 'Bearer k' }, { timeoutMs: 2000 });
    srv.close();
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ got: { a: 1 }, auth: 'Bearer k' });
  });
});
