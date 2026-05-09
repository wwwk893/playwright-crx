# Target Architecture

## Architecture Diagram

```text
┌────────────────────────────────────────────────────────────┐
│ Raw Event Collectors                                      │
│ - Playwright recorder actions                             │
│ - pageContextSidecar events                               │
│ - uiSemantics/business hints                              │
│ - user edits/assertions/repeat                            │
│ - network summary                                         │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Event Journal                                               │
│ append-only facts; stable ids; session high-water marks     │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Session Finalizer                                           │
│ drains pending events; commits open transactions            │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Interaction Transactions                                    │
│ Input / Select / Click / TableRowAction / Dialog / Wait     │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Business Step Projection                                    │
│ transactions → stable FlowStep[]                            │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ UiActionRecipe                                              │
│ shared replay semantics for exported and runtime playback   │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Replay Compiler                                             │
│ - exportedRenderer                                          │
│ - parserSafeRenderer                                        │
│ - assertionRenderer                                         │
│ - repeatRenderer                                            │
│ - actionCounter                                             │
└───────────────────────────┬────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Runtime Player Bridge                                       │
│ narrow fallback only: active popup dispatch, duplicate ids  │
└────────────────────────────────────────────────────────────┘
```

## Layer responsibilities

### Raw Event Collectors

Collect facts only. They must not create `FlowStep` directly.

### Event Journal

Append-only facts. Stores event source, timestamps, source action ids, context event ids, user edits, and session boundaries.

### Session Finalizer

The only place allowed to flush pending events before review/export/codegen.

### Interaction Transactions

Turns low-level facts into user interactions.

Examples:

```text
click input + type chars + change + blur → InputTransaction
click select + fill search + click option → SelectTransaction
click row action + popconfirm confirm → TableRowActionTransaction / ConfirmTransaction
```

### Business Step Projection

Creates stable `FlowStep` from transactions. Preserves user edits.

### UiActionRecipe

A normalized replay semantic contract. Exported code and runtime playback code must both come from this.

### Replay Compiler

Only renders recipes to code. It should not infer business semantics.

### Runtime Player Bridge

Narrow fallback for parser-safe replay. It should not do global selector self-healing.
