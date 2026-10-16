# Moving from Convert to Tailor

Tailor's SDK covers the same ground as Convert's Full Stack SDK with fewer moving parts. Tailor uses its own words for things: a **test** (Convert: experience or feature), a **variant** (variation), the **Original Page** (original or control), and **values** (feature variables).

The main structural change: Convert keeps the visitor on a context object, while Tailor takes `{ id }` on each call.

## In your code

| Convert | Tailor |
|---|---|
| Convert's SDK import | `import { init } from '@tailor-ai/node'` |
| `const sdk = new ConvertSDK({ sdkKey })` then `await sdk.onReady()` | `const tailor = await init({ sdkKey })` |
| `environment: 'live'` | use the production SDK key |
| `const ctx = sdk.createContext(visitorId)` | keep `visitorId` and pass `{ id: visitorId }` on each call |
| `ctx.runFeature(key).status === 'enabled'` | `tailor.getTest(key, { id }).isTailored()` |
| `ctx.runFeature(key).variables` | `tailor.getTest(key, { id }).getValues()` |
| `ctx.runExperience(key)?.key` | `tailor.getTest(key, { id }).variant?.key` |
| `ctx.trackConversion(goal, { conversionData: [{ key: 'amount', value }, { key: 'transactionId', value }] })` | `tailor.convert(goalKey, { id, value, orderId })` |
| `sdk.releaseQueues()` | `tailor.flush()` |
| `dataRefreshInterval` | `pollInterval` |
| `events: { batch_size, release_interval }` | `batchEvents: { maxEvents, flushInterval }` |
| `on(SystemEvents.BUCKETING, …)` | `onTailored` |
| segments, visitor properties, locations, `dataStore` | remove; not in this version |

## In Tailor

1. Create a **Server-side test** for each experience, with the same key and the feature's variables as values on each variant.
2. Use each goal's key in `convert`.
3. Copy the SDK key from **Settings → Websites & publishing → Server-side testing**.
4. Add the Tailor tag to your pages with `Tailor.init({ userId })` set to the same id your server uses.

## What works differently

- **Conversions come from the page.** The Tailor tag records clicks, form submits and page visits under the same visitor id, so you only call `convert` for what the page can't see.
- **A running test's split and values are locked**, so no `dataStore` is needed to keep a visitor's variant. To change them, stop the test and start a new one. Ramping to the winner is always allowed.
- **Preview visitors** are pinned to a variant and never counted in results.
