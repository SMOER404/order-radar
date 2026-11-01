export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
  return body;
}
