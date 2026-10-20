# Changelog

## 0.2.0

- Sequential visitor ids (`1, 2, 3`, `user-41`) are now spread across variants as evenly as random ones. Before, neighbouring ids landed in the same variant about 92% of the time, so customers who signed up together were tested together.
- **This moves visitors between variants.** A test that is running while you upgrade counts some visitors in two variants. Stop the test, deploy 0.2.0 everywhere, then start a new test, so no server is still choosing variants the old way.

## 0.1.0

First prerelease.

- `init({ sdkKey })` downloads your account's test config from Tailor's CDN and refreshes it every 5 minutes.
- `getTest(key, { id })` picks the visitor's variant in memory, with `isTailored()`, `variant`, `getValue()` and `getValues()`.
- `convert(goalKey, { id, value, currency, orderId })` records a goal from your server.
- `flush()` sends waiting events, and `status()` reports whether a config has loaded.
