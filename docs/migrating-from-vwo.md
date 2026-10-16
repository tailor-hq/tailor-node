# Moving from VWO to Tailor

Tailor's SDK keeps the shape of VWO's Feature Experimentation SDK, so most of the change is names. Tailor uses its own words for things: a **test** (VWO: flag), a **variant** (variation), the **Original Page** (control), and **values** (variables).

## In your code

| VWO | Tailor |
|---|---|
| `import { init } from 'wingify-fme-node-sdk'` | `import { init } from '@tailor-ai/node'` |
| `await init({ accountId, sdkKey })` | `await init({ sdkKey })` (the key identifies the account) |
| `const flag = await client.getFlag(key, { id })` | `const test = tailor.getTest(key, { id })` (keeping the `await` is harmless) |
| `flag.isEnabled()` | `test.isTailored()` |
| `flag.getVariable('headline', 'Buy now')` | `test.getValue('headline', 'Buy now')` |
| no equivalent | `test.getValues()`, `test.variant` |
| `client.trackEvent(name, { id }, { revenue, … })` | `tailor.convert(goalKey, { id, value, currency, orderId })` |
| `client.flushEvents()` | `tailor.flush()` |
| `pollInterval`, `logger` | same |
| `batchEventData: { eventsPerRequest, requestTimeInterval }` (seconds) | `batchEvents: { maxEvents, flushInterval }` (milliseconds) |
| `integrations: { callback }` | `onTailored` |
| `customVariables`, `userAgent`, `ipAddress`, `setAttribute` | remove; targeting isn't in this version |
| `storage`, `gatewayService`, `setAlias` | remove |

## In Tailor

1. Create a **Server-side test** for each flag, with the same key and its variables as values on each variant.
2. Give each event a goal, and use the goal's key in `convert`.
3. Copy the SDK key from **Settings → Websites & publishing → Server-side testing**.
4. Add the Tailor tag to your pages with `Tailor.init({ userId })` set to the same id your server uses.

## What works differently

- **Conversions come from the page.** The Tailor tag records clicks, form submits and page visits under the same visitor id, so you only call `convert` for what the page can't see.
- **A running test's split and values are locked.** To change them, stop the test and start a new one. Ramping to the winner is always allowed.
- **Preview visitors are never counted in results** (VWO counts forced users).
- **Defaults:** events are sent every 30 seconds, rather than VWO's 10 minutes, so less is lost when a process exits.
