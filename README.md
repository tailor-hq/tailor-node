# @tailor-ai/node

Run Tailor tests in your own server code. Your server picks each visitor's variant in memory, with no network call per request, and the Tailor tag on your page records what they do next.

- **What:** a test you create in Tailor as a "Server-side test", with values for each variant (a headline, a price, whether to show a badge). Your code reads the value for the visitor and renders it.
- **How:** the SDK downloads your account's test config from Tailor's CDN and checks for changes every 5 minutes. Deciding a variant never leaves your server.
- **Results:** the visitor id you pass here is the same one you pass to the Tailor tag on the page, so every goal the page records counts toward the right variant.
- **Status:** pre-1.0, MIT. Node 18 or later.

Coming from VWO or Convert? See [docs/migrating-from-vwo.md](docs/migrating-from-vwo.md) or [docs/migrating-from-convert.md](docs/migrating-from-convert.md).

## Install

```bash
npm install @tailor-ai/node
```

Works with `import` and `require`.

## Use it

```ts
import { init } from '@tailor-ai/node'

const tailor = await init({ sdkKey: process.env.TAILOR_SDK_KEY })

app.get('/checkout', (req, res) => {
  const visitorId = req.cookies.anon_id          // your own id for this visitor

  const test = tailor.getTest('checkout-v2', { id: visitorId })
  res.render('checkout', {
    headline: test.getValue('headline', 'Buy now'),   // the variant's value, or your default
    showBadge: test.getValue('show_badge', false),
    visitorId
  })
})
```

On the page, before the Tailor tag, pass the same id:

```html
<script>
  window.TailorQueue = window.TailorQueue || []
  window.TailorQueue.push(function () {
    window.Tailor.init({ userId: '<%= visitorId %>' })
  })
</script>
<script src="https://app.tailorhq.ai/script/<your account>.js" async></script>
```

Your SDK key is in Tailor under **Settings → Websites & publishing → Server-side testing**. There's one for production and one for development; only production counts in results. The key isn't secret, but it isn't an API key either, so never use an API key here.

## What `getTest` returns

| Test status | Visitor with an id | Preview visitor | No id |
|---|---|---|---|
| Running test | their variant, counted in results | the variant chosen for them, never counted | your code defaults |
| Ramped | the winning variant | the winning variant | the winning variant |
| Stopped, Draft, or unknown key | your code defaults | your code defaults | your code defaults |

- `test.isTailored()`: true when the visitor gets a variant. The Original Page counts as a variant.
- `test.variant`: `{ key, name }`, or `null`. The Original Page's key is `control`.
- `test.getValue(name, default)`: the variant's value, or `default` when there's no variant, no such value, or the value's type differs from the default's.
- `test.getValues()`: every value, or `{}`.

The first `getTest` call for a visitor in a running test counts them in the test. Call it where you actually use the variant, not in prefetch code.

## Record a conversion from your server

Most goals are recorded by the Tailor tag on the page. Use `convert` only for what the page can't see, such as a purchase confirmed by a payment webhook:

```ts
tailor.convert('purchase', {
  id: order.metadata.anonId,     // the same id the page used
  value: order.total,
  currency: 'USD',
  orderId: order.id              // a purchase reported twice with one order id counts once
})
```

The goal key is shown on each goal in Tailor, and it's the same key `Tailor.convert` takes on a page. A goal you create in Tailor counts from its first conversion. The SDK doesn't check the key, so a mistyped one is sent and counts toward nothing; if a goal shows no conversions, check its key first.

## Keep one id from first visit to purchase

1. On the first request, set your own first-party cookie with an anonymous id.
2. Pass it to `getTest`.
3. Pass it to `Tailor.init({ userId })` on the page.
4. Save it on the order at checkout.
5. Send it with `convert` from the payment webhook.

Don't switch to the account id when the visitor logs in. The purchase then arrives under a different id and won't count toward the test.

## Pages served from a shared cache

A response that contains one visitor's variant must never be cached and served to someone else. Render per request, or cache per variant (key the cache on `test.variant.key`). A static or ISR page built once for everyone can't carry a variant.

## Serverless

```ts
export const handler = async (event) => {
  const test = tailor.getTest('checkout-v2', { id })
  // ...
  await tailor.flush()   // send waiting events before the function freezes
  return response
}
```

Events are held in memory and sent every 30 seconds or every 100 events. Anything still waiting when a process exits is lost, so send purchases from a job or webhook that retries.

## Options

```ts
await init({
  sdkKey: '…',
  pollInterval: 300_000,                                // how often to check for a new config, in ms
  logger: { warn, error },                              // defaults to the console
  batchEvents: { maxEvents: 100, flushInterval: 30_000 },
  onTailored: ({ testKey, variant, visitorId }) => {}   // when a visitor is first counted, for your own analytics
})
```

## When things go wrong

- **No config yet:** `init` waits up to 3 seconds. Until a config arrives, every test returns your code defaults, and the SDK keeps trying.
- **A bad or unreachable config:** the SDK keeps the last good one.
- **Stopping a test:** servers return your code defaults within 5 minutes.
- **`tailor.status()`** tells you whether a config has loaded, how old it is, the last error, and how many events were dropped.

## License

MIT
