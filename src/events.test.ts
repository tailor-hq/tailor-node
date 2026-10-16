import { EventQueue, MAX_QUEUED_EVENTS, type TailorEventPayload } from './events';

const event = (i: number): TailorEventPayload => ({
  name: 'sdk_exposure',
  eventType: 'experiment',
  timestamp: i,
  metadata: { orgId: 'org', userId: `v${i}`, source: 'sdk', version: '0.1.0', properties: {} }
});

const logger = { warn: jest.fn(), error: jest.fn() };

describe('EventQueue', () => {
  it('sends in batches of at most maxEvents', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const queue = new EventQueue({ maxEvents: 3, flushInterval: 60_000, logger, fetchImpl });
    queue.setTrackingUrl('https://t.example.test/t/');
    for (let i = 0; i < 7; i++) queue.push(event(i));
    const result = await queue.flush();
    // Sending started on its own when the first batch filled; flush() waited
    // for that send and counts it, so a serverless handler sees the real total.
    expect(result).toEqual({ sent: 7, dropped: 0 });
    expect(bodies.map((b: any) => b.events.length).every((n) => n <= 3)).toBe(true);
    expect(bodies.reduce((sum: number, b: any) => sum + b.events.length, 0)).toBe(7);
  });

  it('drains a burst that arrives during a slow send in one pass, not one flush per event', async () => {
    let posts = 0;
    let release: () => void = () => {};
    const firstSendHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async () => {
      posts += 1;
      if (posts === 1) await firstSendHeld;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const queue = new EventQueue({ maxEvents: 100, flushInterval: 60_000, logger, fetchImpl });
    queue.setTrackingUrl('https://t.example.test/t/');
    for (let i = 0; i < 5_000; i++) queue.push(event(i));
    const flushed = queue.flush();
    release();
    expect(await flushed).toEqual({ sent: 5_000, dropped: 0 });
    expect(posts).toBe(50);
  });

  it('drops and counts a batch the endpoint refuses, without retrying a 400', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response('bad', { status: 400 });
    }) as unknown as typeof fetch;
    const queue = new EventQueue({ maxEvents: 100, flushInterval: 60_000, logger, fetchImpl });
    queue.setTrackingUrl('https://t.example.test/t/');
    queue.push(event(1));
    const result = await queue.flush();
    expect(result).toEqual({ sent: 0, dropped: 1 });
    expect(queue.dropped).toBe(1);
    expect(attempts).toBe(1);
  });

  it('holds events until it knows where to send them', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const queue = new EventQueue({ maxEvents: 100, flushInterval: 60_000, logger, fetchImpl });
    queue.push(event(1));
    expect(await queue.flush()).toEqual({ sent: 0, dropped: 0 });
    expect(queue.size).toBe(1);
  });

  it('counts events past the queue cap as dropped', () => {
    const queue = new EventQueue({ maxEvents: 100_000, flushInterval: 60_000, logger, fetchImpl: jest.fn() as unknown as typeof fetch });
    for (let i = 0; i < MAX_QUEUED_EVENTS + 5; i++) queue.push(event(i));
    expect(queue.dropped).toBe(5);
  });
});
