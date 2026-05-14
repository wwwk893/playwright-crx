# CRX Regression Test Layering

This suite uses explicit L1/L2/L3 layers. Keep the layers separate when adding
tests or reporting validation, because each layer answers a different question.

## L1: Flow, Codegen, And Recipe Contracts

Command:

```bash
npm run test:crx:business-flow:l1
```

Canonical file:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
```

L1 does not launch a real browser. It protects pure contracts: event journal,
session finalization, transaction composition, business projection, recipe
derivation, exported/parser-safe replay output, action counting, terminal
assertion rendering, export redaction, legacy migration, and adaptive
diagnostics redaction.

## L2: Deterministic CRX Generated Replay

Command:

```bash
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
```

Canonical file:

```text
tests/crx/businessFlowRecorder.spec.ts
```

L2 launches the real extension and browser, but deterministic helpers may drive
fixture setup and difficult AntD/ProComponents portal controls. Every generated
replay case must prove a terminal business state such as row exists/not exists,
modal hidden, selected value visible, validation visible, toast visible, or a
repeat-loop row outcome. A generated script merely finishing is not enough.

## L3: Human-Like Smoke

Command:

```bash
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
```

Canonical files:

```text
tests/crx/humanLikeRecorder.spec.ts
tests/crx/humanLike.ts
```

L3 uses real mouse and keyboard behavior for high-value user paths. Helpers may
open fixtures, attach the recorder, gather diagnostics, and wait for real
business states. They must not silently replace the user interaction under test
with force clicks, dispatch events, fixed sleeps, or mocks. If a fallback is
needed, it must either fail the L3 path or be attached as explicit failure
evidence.

## Focused Runtime Bridge Tests

File:

```text
tests/crx/player-runtime-bridge.spec.ts
```

These tests sit between L2 and server/runtime contract coverage. Use them for
narrow parser-safe runtime bridge contracts such as active AntD popup dispatch,
duplicate test id ordinal replay, or active Popconfirm confirmation. Do not use
them to introduce broad text fallback, selector self-healing, or business
semantic guessing in `src/server/*`.

## Legacy CRX Regression

Command:

```bash
npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
```

Legacy tests protect upstream recorder/player compatibility. They are not a
substitute for L1/L2/L3 business-flow validation, but runtime bridge changes
must keep them green.

## Aggregate Compatibility Command

The historical aggregate command is intentionally preserved:

```bash
npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
```

Use this for full local parity with existing CI behavior and for existing
targeted `-g` workflows. Use the explicit L1/L2/L3 scripts when a PR body or CI
step needs to state which layer was exercised.

## Failure Triage

Use the failing layer to choose the next action:

```text
L1 fail: contract, projection, codegen, redaction, or migration bug.
L2 fail: CRX integration, generated replay, artifact, or terminal-state bug.
L3 fail: realistic user path, timing, recording stability, or fallback bug.
Legacy fail: upstream player/recorder compatibility or runtime bridge regression.
```

For replay failures, inspect:

```text
tests/.raw-generated-replay/
tests/test-results/
tests/playwright-report/
```

Do not make tests pass by deleting terminal assertions, replacing real
AntD/ProComponents fixtures with mocks, adding blind sleeps, or turning L3 into
a deterministic helper path.
