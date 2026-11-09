# browser_actions: the action catalogue

Generated from `internal/actions/catalog.mjs` by `tools/browser-action-doc.mjs`.
Do not edit by hand: run the tool, and `--check` will keep it honest.

Every field a handler reads is declared here and in the tool's public `parameters`,
validated by `internal/actions/schemas.mjs` before any connection is opened.

| action | effect | retry | resources | fields |
|---|---|---|---|---|
| `navigate` | navigation | never | browser-target, browser-document | `url` (required): string |
| `click` | write | never | browser-target | `ref` (required): string<br>`verify`: object |
| `fill` | write | never | browser-target | `ref` (required): string<br>`value` (required): string |
| `type` | write | never | browser-target | `ref` (required): string<br>`value` (required): string |
| `upload` | write | never | browser-target, local-file | `ref` (required): string<br>`files` (required): string-array |
| `scroll` | write | never | browser-target | `dx`: number<br>`dy`: number<br>`ref`: string |
| `hover` | write | never | browser-target | `ref` (required): string |
| `press` | write | never | browser-target | `key` (required): string<br>`code`: string<br>`ref`: string<br>`verify`: object |
| `select` | write | never | browser-target | `ref` (required): string<br>`value` (required): string |
| `tabs` | write | never | browser-target, browser-context | `operation`: string<br>`tab`: string<br>`url`: string |
| `wait_for` | read | safe-read | browser-target | `condition` (required): object |
| `state` | read | safe-read | browser-target | `filter`: string<br>`max_nodes`: integer<br>`max_chars`: integer |

## Limits

- steps per call: 20
- upload: 20 file(s), each path at most 1024 character(s)
- scroll: each axis within ±100000 CSS pixels, and at least one non-zero unless a ref is given
- state: at most 1000 node(s) and 20000 character(s)

## Field notes

- `url` (string): navigate: where to go.
- `ref` (string): click: a reference from browser_state, checked against the connection, target, frame and document it was read from before it is used.
- `verify` (object): click: what to look for afterwards (`{name: "…"}`). Without it the step is reported as `not_verified` rather than implied to have worked.
- `value` (string): fill: the text to put in the field, through the page's own input/change events so frameworks notice.
- `files` (string-array): upload: paths on the machine the browser runs on (20 at most).
- `dx` (number): scroll: horizontal wheel delta in CSS pixels.
- `dy` (number): scroll: vertical wheel delta in CSS pixels.
- `key` (string): press: the key (e.g. "Enter", "Tab", "Escape").
- `code` (string): press: the physical key code; defaults to the key itself.
- `operation` (string): tabs: list (default), create, activate or close.
- `tab` (string): tabs: the target this operation acts on; defaults to the tab this call is bound to. This is the step’s own tab, not the call-level `tab` that binds the whole call.
- `condition` (object): wait_for: what to wait for — at least one of name/text, or a url substring.
- `filter` (string): state: substring over role, name and value.
- `max_nodes` (integer): state: node budget (default 200, maximum 1000).
- `max_chars` (integer): state: character budget.
