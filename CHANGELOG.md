# Changelog

## 0.1.0

First prerelease.

- `init({ sdkKey })` downloads your account's test config from Tailor's CDN and refreshes it every 5 minutes.
- `getTest(key, { id })` picks the visitor's variant in memory, with `isTailored()`, `variant`, `getValue()` and `getValues()`.
- `convert(goalKey, { id, value, currency, orderId })` records a goal from your server.
- `flush()` sends waiting events, and `status()` reports whether a config has loaded.
