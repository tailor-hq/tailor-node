# Contributing

```bash
npm install
npm test
npm run lint      # typechecks the source and the tests
npm run build     # declarations, then ESM and CommonJS builds
```

Issues and pull requests are welcome. We develop this package alongside the
rest of Tailor, so a pull request we take is applied there and reaches this
repository with the next release.

## The rules this package is built on

A change that breaks one of these needs a very good argument.

**1. It never fails or slows a request.** This runs on the request path of
somebody's server. Every error path (the CDN down, a malformed config, a bug in
here) returns the default the caller passed. Nothing throws to a caller after
`init`, and nothing awaits the network inside `getTest` or `convert`.

**2. Variant assignment must agree with the Tailor tag.** A visitor bucketed
here and on the page has to land in the same variant, or results are wrong.
`src/internal/assignment.vectors.json` pins the expected assignments, and the
same file is checked against the browser's implementation. A change that moves
any visitor between variants is a breaking change, not a fix.

**3. The public API is permanent once published.** `src/package-shape.test.ts`
pins the exports and the `import`/`require` entries. Adding is a minor version;
removing or renaming is a major one. Ship less and grow.

## What a change needs

- **A test that fails without it.** For anything touching a fallback, break the
  code deliberately and watch the tests go red before you restore it.
- **The corner cases, not just the happy path.** No config yet, an unknown test
  key, a missing visitor id, a value of the wrong type, the same visitor twice.
- **A comment saying *why*, where the reason is not obvious.** The published
  JavaScript has comments stripped, so a good comment costs a customer nothing;
  the type declarations keep their docblocks, which is where an SDK's docs reach
  the customer's editor.
- **A CHANGELOG entry.**

## What does not belong here

- **Runtime dependencies.** There are none and there should stay none.
- **A network call on the request path.** The config is read from memory; events
  are queued and sent in the background.
- **Cookies or visitor state.** The caller owns the visitor id.
