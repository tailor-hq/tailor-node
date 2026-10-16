# Security

## Reporting a vulnerability

Email **security@tailorhq.ai**. Please do not open a public issue.

Include what you can reproduce and what it lets an attacker do. We will
acknowledge within two business days.

## What this package is trusted with

It runs inside your server, on the request path, and decides what a visitor is
shown. Three things follow.

**It never makes a network call per request.** Picking a variant happens in
memory, from a config the SDK downloads from Tailor's CDN at start and checks
for changes every 5 minutes. Events are sent in batches in the background. A
slow or unreachable Tailor never slows a request; every test falls back to the
default your code passed.

**The SDK key is not a secret, and it is not an API key.** It reads one thing:
your account's test config, which holds test keys, variant names, splits and
the values you set for each variant. Treat anything you put in a value as
something a visitor could see, because your server renders it to them anyway.
Never pass a Tailor API key as the `sdkKey`.

**Visitor ids stay on your server.** The id you pass to `getTest` and `convert`
is hashed before anything is sent, and only the hash travels with an event. The
hash exists so the SDK and the Tailor tag on your page agree on who a visitor
is. It is not a privacy guarantee, so use an opaque id (a cookie value, an
internal user id), never an email address or a name. Preview visitor ids in the
config are hashed the same way.

## What it deliberately does not do

- No runtime dependencies.
- No network call other than to Tailor's CDN for the config and Tailor's
  tracking endpoint for events.
- No `eval`, no dynamic code from the config: values are data, never code.
- No cookies; your code owns the visitor id.

## Supported versions

Pre-1.0. Fixes land on the latest minor.
