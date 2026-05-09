# Diagnostics and Privacy-Safe Debuggability

## 1. Goal

Recorder/replay failures need to be explainable without leaking sensitive business data.

PR #10 and PR #11 privacy guarantees must remain intact:

```text
diagnostics off by default
no full DOM in export or AI input
no rawAction/sourceCode in AI input
compact exports omit locatorHints, reasons, rowText, overlay.text, and raw option values
```

MVP 0.1.7 diagnostics should help answer:

```text
Why did generated replay choose this locator?
Why was an option suppressed?
Why was a terminal assertion suggested or skipped?
Why was a row action scoped this way?
Why did replay fallback become weak?
```

## 2. Diagnostic categories

Recommended event names:

```text
replay.locator.business-testid
replay.locator.scoped-row-action
replay.locator.scoped-dialog-action
replay.locator.scoped-popconfirm
replay.locator.suppressed-placeholder-option
replay.locator.weak-fallback
replay.assertion.suggested-terminal-state
replay.assertion.skipped-insufficient-context
replay.assertion.skipped-privacy-risk
replay.asset.parser-safe-fallback
```

## 3. Diagnostic shape

```ts
export interface ReplayDiagnosticEntry {
  id: string;
  time: string;
  level: 'debug' | 'info' | 'warn';
  event: string;
  stepId?: string;
  action?: string;
  recipeKind?: string;
  component?: string;
  library?: string;
  targetTestId?: string;
  table?: string;
  rowKey?: string;
  column?: string;
  overlayType?: string;
  overlayTitle?: string;
  terminalAssertion?: string;
  decision: string;
  reasonCodes: string[];
}
```

Avoid unbounded strings. All strings should be compact and redacted.

## 4. Forbidden diagnostic fields

Never record:

```text
full DOM
outerHTML / innerHTML
rawAction
sourceCode
full selector path with private text
locatorHints full values
reasons full array if it includes private strings
rowText full value
overlay.text full value
option.value raw value
input values
request/response bodies
cookies/tokens/passwords/auth headers/API keys/private keys/connection strings
full URL query/hash
```

If a value may be sensitive, store `[REDACTED]` or omit it.

## 5. Storage

Use existing diagnostics behavior if present. Otherwise:

```text
memory/session ring buffer
max 200 entries
default disabled
not persisted into BusinessFlow
not exported
not included in compact YAML
not sent to AI
```

## 6. Feature flag

Use or extend existing flag:

```ts
semanticAdapterDiagnosticsEnabled?: boolean;
```

If a dedicated replay flag is added, keep it narrow:

```ts
replayDiagnosticsEnabled?: boolean;
```

Default must be `false`.

## 7. Debug UI / reporting

MVP 0.1.7 does not need a polished UI. Acceptable outputs:

```text
side panel diagnostic list if existing mechanism supports it
console-safe compact logs during local test mode
JSONL export only from manual debug action, never automatic flow export
```

## 8. Examples

### Good

```json
{
  "event": "replay.locator.scoped-row-action",
  "stepId": "s042",
  "recipeKind": "table-row-action",
  "targetTestId": "wan-transport-row-delete-action",
  "table": "wan-transport",
  "rowKey": "row-nova-public",
  "decision": "scope duplicate action test id by table row",
  "reasonCodes": ["duplicate-testid", "row-key-present"]
}
```

### Bad

```json
{
  "rowText": "full row text with private customer data",
  "rawAction": { "...": "..." },
  "sourceCode": "await page...",
  "dom": "<div>...</div>"
}
```

## 9. Tests

Add tests proving:

```text
diagnostics default off
diagnostics do not change generated replay
diagnostics do not enter export/compact/AI input
large/private strings are truncated/redacted
rowText/overlay.text/option.value not stored
```

## 10. Rollback

Diagnostics must be removable without affecting core replay behavior. If diagnostics cause failures, disable them by flag and keep replay tests intact.
