import { TailorClient } from './client';
import type { ServerSdkConfig } from './config';
import { simpleHash } from './internal/assignment';

const TRACKING_URL = 'https://cached-api.example.test/t/';

const baseConfig = (overrides: Partial<ServerSdkConfig> = {}): ServerSdkConfig => ({
  schemaVersion: 1,
  revision: '2026-10-13T00:00:00.000Z',
  orgId: '11111111-1111-4111-8111-111111111111',
  environment: 'production',
  trackingUrl: TRACKING_URL,
  tests: [
    {
      key: 'checkout-v2',
      name: 'Checkout v2',
      status: 'running',
      trackingKey: 'abcDEF--checkout-v2',
      previewVisitors: {},
      variants: [
        { key: 'control', name: 'Original Page', fraction: 0.5, values: { headline: 'Buy now', show_badge: false } },
        { key: 'variant-1', name: 'Shorter checkout', fraction: 0.5, values: { headline: 'Check out', show_badge: true } }
      ]
    },
    {
      key: 'pricing',
      name: 'Pricing',
      status: 'ramped',
      trackingKey: 'abcDEF--pricing',
      previewVisitors: {},
      variants: [{ key: 'variant-1', name: 'Annual first', fraction: 1, values: { plan: 'annual' } }]
    }
  ],
  ...overrides
});

interface Call {
  url: string;
  init?: RequestInit;
}

const jsonResponse = (body: unknown, init: { status?: number; etag?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.etag ? { etag: init.etag } : {}
  });

/** A fetch that serves `config` for the config URL and accepts every event batch. */
const fakeFetch = (config: unknown, calls: Call[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === TRACKING_URL) return new Response('{"success":true}', { status: 200 });
    return jsonResponse(config, { etag: '"rev-1"' });
  }) as typeof fetch;

const quietLogger = { warn: jest.fn(), error: jest.fn() };

const startClient = async (config: unknown = baseConfig(), calls: Call[] = [], options = {}) => {
  const client = new TailorClient(
    { sdkKey: 'tsk_prod_test', logger: quietLogger, apiBaseUrl: 'https://cached-api.example.test', ...options },
    fakeFetch(config, calls)
  );
  await client.start();
  return client;
};

const sentEvents = (calls: Call[]) =>
  calls
    .filter((c) => c.url === TRACKING_URL)
    .flatMap((c) => (JSON.parse(String(c.init?.body)) as { events: Array<Record<string, any>> }).events);

afterEach(() => {
  quietLogger.warn.mockClear();
  quietLogger.error.mockClear();
});

describe('getTest', () => {
  it('gives a visitor in a running test the same variant on every call, and counts them once', async () => {
    const calls: Call[] = [];
    const client = await startClient(baseConfig(), calls);
    const first = client.getTest('checkout-v2', { id: 'visitor-1' });
    const second = client.getTest('checkout-v2', { id: 'visitor-1' });

    expect(first.isTailored()).toBe(true);
    expect(second.variant).toEqual(first.variant);
    await client.flush();
    const events = sentEvents(calls);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'sdk_exposure',
      eventType: 'experiment',
      experiments: [{ experimentId: 'abcDEF--checkout-v2', treatment: first.variant!.key }],
      metadata: {
        userId: simpleHash('visitor-1'),
        source: 'sdk',
        properties: { sdkEnvironment: 'production', useClientTimestampAsServerTimestamp: 'true', testKey: 'checkout-v2' }
      }
    });
    client.close();
  });

  it('reads values for the variant, falling back to the default on a type mismatch', async () => {
    const client = await startClient();
    const test = client.getTest('checkout-v2', { id: 'visitor-1' });
    const expected = test.variant!.key === 'control' ? 'Buy now' : 'Check out';
    expect(test.getValue('headline', 'fallback')).toBe(expected);
    expect(test.getValue('headline', 42)).toBe(42);
    expect(test.getValue('missing', 'fallback')).toBe('fallback');
    expect(Object.keys(test.getValues())).toEqual(['headline', 'show_badge']);
    client.close();
  });

  it('gives everyone the winner of a ramped test, including visitors with no id, and counts nobody', async () => {
    const calls: Call[] = [];
    const client = await startClient(baseConfig(), calls);
    const withId = client.getTest('pricing', { id: 'visitor-1' });
    const withoutId = client.getTest('pricing', { id: '' });
    expect(withId.variant).toEqual({ key: 'variant-1', name: 'Annual first' });
    expect(withoutId.getValue('plan', 'monthly')).toBe('annual');
    await client.flush();
    expect(sentEvents(calls)).toHaveLength(0);
    client.close();
  });

  it('returns the code defaults for a running test when no id is given, and warns once', async () => {
    const client = await startClient();
    const result = client.getTest('checkout-v2', { id: '' });
    client.getTest('checkout-v2', { id: '' });
    expect(result.isTailored()).toBe(false);
    expect(result.variant).toBeNull();
    expect(result.getValue('headline', 'default')).toBe('default');
    expect(result.getValues()).toEqual({});
    expect(quietLogger.warn).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('returns the code defaults for an unknown test key', async () => {
    const client = await startClient();
    expect(client.getTest('stopped-test', { id: 'visitor-1' }).isTailored()).toBe(false);
    client.close();
  });

  it('shows a preview visitor their chosen variant and never counts them', async () => {
    const calls: Call[] = [];
    const config = baseConfig();
    config.tests[0].previewVisitors = { [simpleHash('qa-person')!]: 'variant-1' };
    const client = await startClient(config, calls);
    expect(client.getTest('checkout-v2', { id: 'qa-person' }).variant?.key).toBe('variant-1');
    await client.flush();
    expect(sentEvents(calls)).toHaveLength(0);
    client.close();
  });

  it('returns the code defaults before any config has loaded, without throwing', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = new TailorClient({ sdkKey: 'tsk_prod_test', logger: quietLogger }, failing);
    await client.start();
    expect(client.getTest('checkout-v2', { id: 'visitor-1' }).isTailored()).toBe(false);
    expect(client.status()).toMatchObject({ ready: false, lastError: expect.stringContaining('offline') });
    client.close();
  });

  it('calls onTailored once per counted visitor', async () => {
    const onTailored = jest.fn();
    const client = await startClient(baseConfig(), [], { onTailored });
    client.getTest('checkout-v2', { id: 'visitor-2' });
    client.getTest('checkout-v2', { id: 'visitor-2' });
    expect(onTailored).toHaveBeenCalledTimes(1);
    expect(onTailored.mock.calls[0][0]).toMatchObject({ testKey: 'checkout-v2', visitorId: 'visitor-2' });
    client.close();
  });
});

describe('convert', () => {
  it('records a goal with revenue and an order id under the hashed visitor id', async () => {
    const calls: Call[] = [];
    const client = await startClient(baseConfig(), calls);
    client.convert('purchase', { id: 'visitor-1', value: 49, currency: 'usd', orderId: 'A-1001' });
    const result = await client.flush();
    expect(result).toEqual({ sent: 1, dropped: 0 });
    expect(sentEvents(calls)[0]).toMatchObject({
      name: 'conversion-goal-purchase',
      eventType: 'conversion',
      metadata: {
        userId: simpleHash('visitor-1'),
        source: 'sdk',
        properties: { revenueValue: 49, revenueCurrency: 'USD', orderId: 'A-1001', conversionGoalKey: 'purchase' }
      }
    });
    client.close();
  });

  it('records a goal the config has never heard of, so a new goal counts at once', async () => {
    const calls: Call[] = [];
    const client = await startClient(baseConfig(), calls);
    client.convert('made-a-minute-ago', { id: 'visitor-1' });
    await client.flush();
    expect(sentEvents(calls)[0]).toMatchObject({ name: 'conversion-goal-made-a-minute-ago' });
    client.close();
  });

  it('drops a conversion with no goal key, with a warning', async () => {
    const calls: Call[] = [];
    const client = await startClient(baseConfig(), calls);
    client.convert('', { id: 'visitor-1' });
    await client.flush();
    expect(sentEvents(calls)).toHaveLength(0);
    expect(quietLogger.warn).toHaveBeenCalledWith(expect.stringContaining('without a goal key'));
    client.close();
  });
});

describe('config refresh', () => {
  it('keeps the last good config when a new one is refused', async () => {
    let served: unknown = baseConfig();
    const fetchImpl = (async () => jsonResponse(served)) as unknown as typeof fetch;
    const client = new TailorClient({ sdkKey: 'tsk_prod_test', logger: quietLogger, pollInterval: 1000 }, fetchImpl);
    await client.start();
    served = { ...baseConfig(), tests: 'broken' };
    await (client as unknown as { refresh: () => Promise<void> }).refresh();
    expect(client.getTest('checkout-v2', { id: 'visitor-1' }).isTailored()).toBe(true);
    expect(client.status().lastError).toContain('Refused a config');
    client.close();
  });

  it('sends the revision it holds and accepts a 304 as current', async () => {
    const calls: Call[] = [];
    let first = true;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (first) {
        first = false;
        return jsonResponse(baseConfig(), { etag: '"rev-1"' });
      }
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    const client = new TailorClient({ sdkKey: 'tsk_prod_test', logger: quietLogger }, fetchImpl);
    await client.start();
    await (client as unknown as { refresh: () => Promise<void> }).refresh();
    expect((calls[1].init?.headers as Record<string, string>)['if-none-match']).toBe('"rev-1"');
    expect(client.status()).toMatchObject({ ready: true, lastError: null });
    client.close();
  });
});
