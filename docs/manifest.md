# Project Manifest

Each tested project is defined by a manifest and never hardcoded. The parser in `packages/core`
(`parseManifest`) is the single source of truth: every package reads the manifest through it.

## Format

A JSON file, at most 64 KiB. `parseManifest` accepts the file text or an already-parsed object and returns either a
frozen, typed manifest or a list of issues (`{ code, path }`). It never returns partial data and never echoes the
offending value.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `projectId` | string | yes | Lower-case id: `a-z`, `0-9`, `-`. Up to 64 characters. |
| `allowedTargetUrlPattern` | string | yes | Regular expression source tested against the target origin. Must start with `^`, end with an unescaped `$`, have no top-level `\|`, and compile. Up to 500 characters. |
| `blockedTargets` | string[] | yes | At least one, up to 100. Case-insensitive host fragments (`a-z`, `0-9`, `.`, `-`). Always win over the allowlist, so production belongs here. |
| `testAccountVariableNames` | string[] | yes | Up to 20 names of environment variables (`UPPER_SNAKE_CASE`). Never values. May be empty. |
| `availableScenarios` | string[] | no | Up to 200 scenario ids. Defaults to empty. |
| `screens` | `{ id, hidden }[]` | yes | Up to 200. `id` is a lower-case id, `hidden` is required and boolean. A hidden screen is masked in generated views and never explored. Ids are unique. |
| `forbiddenActions` | string[] | yes | Up to 100 phrases, each up to 80 characters (for example `delete account`). May be empty. |

Every string, in every field, is rejected when it is shaped like an e-mail, token, key, JWT or secret assignment
(the core sanitizer rules). The allowlist pattern is the only field allowed to contain a URL scheme.
Lists reject duplicates.

## Example

See [`examples/manifest.example.json`](../examples/manifest.example.json) (placeholders only):

```json
{
  "projectId": "example-project",
  "allowedTargetUrlPattern": "^https://qa-[a-z0-9-]+\\.example\\.test$",
  "blockedTargets": ["prod", "www."],
  "testAccountVariableNames": ["QA_ACCOUNT_A"],
  "availableScenarios": ["scenario-one"],
  "screens": [
    { "id": "screen-one", "hidden": false },
    { "id": "screen-hidden", "hidden": true }
  ],
  "forbiddenActions": ["delete account", "purchase", "sign out"]
}
```

## Unknown fields

Rejected (`unknown-field`), both at the top level and inside a screen. A typo in a safety field must not be silently
ignored.

## Reason codes

Each issue is `<code> <path>`, for example `missing-field screens[0].hidden`.

| Code | Meaning |
| --- | --- |
| `invalid-json` | The text is not valid JSON. |
| `too-large` | The text is over 64 KiB. |
| `not-an-object` | The root is not an object. |
| `missing-field` | A required field is absent. |
| `invalid-type` | A field has the wrong type. |
| `invalid-value` | Empty, wrong shape, or an empty `blockedTargets`. |
| `unknown-field` | A field the manifest does not define. |
| `unanchored-pattern` | The allowlist pattern is not anchored with `^`/`$`, or has top-level alternation. |
| `invalid-pattern` | The allowlist pattern does not compile. |
| `secret-shaped` | A value looks like an e-mail, token or key. |
| `too-many-items` | A list is over its limit. |
| `too-long` | A string is over its limit. |
| `duplicate` | A repeated entry in a list. |

## Validate a file

```
npm run build
npm run validate-manifest -- path/to/manifest.json
```

Prints `ok` (exit 0) or one `<code> <path>` line per issue (exit 1). Values are never printed.

## Migrating from `screensToHide`

The first draft of this doc listed `screensToHide` (selectors or regions to mask). The generator, which needs to know
which screens a test may target, introduced a `screens` list instead, and `screens` is now the only form. A selector
is not a screen id, so `screensToHide` is rejected as an unknown field. To migrate, list every screen in `screens` and
mark the ones that were hidden with `"hidden": true`. `migrateLegacyManifest(input)` does the mechanical part: it turns
each `screensToHide` entry into `{ id, hidden: true }`, and an entry that is a selector is then rejected by path
(`invalid-value screens[i].id`) so it gets renamed by hand.

## Rules

- Production targets are always blocked, and a blocked target wins over the allowlist.
- Manifest values are reviewed before execution.
- Secrets are referenced by variable name only, never embedded values.
