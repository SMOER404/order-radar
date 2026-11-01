import type { Agent } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Агент для выхода через прокси: http://, https://, socks5:// (socks5h:// — DNS через прокси).
 * Нужен, когда сервер в РФ не видит api.telegram.org или LLM-провайдер блокирует российские IP.
 */
export function createProxyAgent(proxyUrl?: string): Agent | undefined {
  if (!proxyUrl) return undefined;
  const proto = new URL(proxyUrl).protocol;
  if (proto.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
  if (proto === 'http:' || proto === 'https:') return new HttpsProxyAgent(proxyUrl);
  throw new Error(`Неподдерживаемый протокол прокси: ${proto}`);
}

/** Параметры прокси для GramJS (MTProto умеет только SOCKS) */
export function gramjsProxy(proxyUrl?: string) {
  if (!proxyUrl) return undefined;
  const u = new URL(proxyUrl);
  if (!u.protocol.startsWith('socks')) return undefined;
  return {
    ip: u.hostname,
    port: Number(u.port || 1080),
    socksType: (u.protocol.startsWith('socks4') ? 4 : 5) as 4 | 5,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    timeout: 10,
  };
}

/** Минимальный POST JSON через node:https с поддержкой агента (глобальный fetch агенты не принимает) */
export function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { agent?: Agent; timeoutMs: number },
): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  const payload = Buffer.from(JSON.stringify(body));
  const req = u.protocol === 'http:' ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const r = req(
      u,
      {
        method: 'POST',
        agent: opts.agent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(payload.length), ...headers },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    r.on('timeout', () => r.destroy(new Error(`Таймаут ${opts.timeoutMs} мс: ${u.host}`)));
    r.on('error', reject);
    r.end(payload);
  });
}
