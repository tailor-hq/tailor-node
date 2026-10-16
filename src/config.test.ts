import { validateConfig } from './config';

const valid = () => ({
  schemaVersion: 1,
  revision: 'r1',
  orgId: 'org',
  environment: 'production',
  trackingUrl: 'https://cached-api.example.test/t/',
  tests: [
    {
      key: 'a',
      name: 'A',
      status: 'running',
      trackingKey: 'org--a',
      previewVisitors: {},
      variants: [
        { key: 'control', name: 'Original Page', fraction: 0.5, values: {} },
        { key: 'variant-1', name: 'B', fraction: 0.5, values: {} }
      ]
    }
  ]
});

describe('validateConfig', () => {
  it('accepts a complete config', () => {
    expect('config' in validateConfig(valid())).toBe(true);
  });

  it.each([
    ['a different schema version', (c: any) => (c.schemaVersion = 2)],
    ['no tracking URL', (c: any) => delete c.trackingUrl],
    ['an unknown environment', (c: any) => (c.environment = 'staging')],
    ['a split that does not add up', (c: any) => (c.tests[0].variants[1].fraction = 0.4)],
    ['a duplicate test key', (c: any) => c.tests.push({ ...c.tests[0] })],
    ['a stopped test', (c: any) => (c.tests[0].status = 'stopped')],
    ['a test with no variants', (c: any) => (c.tests[0].variants = [])]
  ])('refuses %s', (_label, mutate) => {
    const config = valid();
    mutate(config);
    expect('error' in validateConfig(config)).toBe(true);
  });
});
