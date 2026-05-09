# PR Split and Acceptance Gates

## 1. Recommended PR sequence

### Plugin PR 1: terminal-state assertion regressions

Branch:

```bash
feat/mvp-017-terminal-state-regressions
```

Goal:

```text
Add failing/negative tests first for terminal-state replay quality.
```

Likely files:

```text
examples/recorder-crx/src/flow/stepStability.test.ts
tests/crx/humanLikeRecorder.spec.ts
tests/crx/businessFlowRecorder.spec.ts
tests/server/src/antdWanTransportRealApp.tsx
```

Acceptance:

```text
Tests demonstrate current or future failure if row/modal/popconfirm terminal state is missing.
No production code changes except fixture additions if needed.
```

---

### Plugin PR 2: replay asset quality hardening

Branch:

```bash
feat/mvp-017-replay-asset-quality
```

Goal:

```text
Harden codePreview/runtime replay emission using existing semantic context and business hints.
```

Likely files:

```text
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/flowBuilder.ts
examples/recorder-crx/src/flow/pageContextMatcher.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Acceptance:

```text
placeholder suppression final emit layer test passes
row scoped action test passes
Popconfirm visible scope test passes
parser-safe replay tests pass
focused WAN/runtime tests pass
```

---

### Plugin PR 3: privacy-safe replay diagnostics

Branch:

```bash
feat/mvp-017-replay-diagnostics
```

Goal:

```text
Add optional diagnostics for replay locator/assertion decisions.
```

Likely files:

```text
examples/recorder-crx/src/uiSemantics/diagnostics.ts
examples/recorder-crx/src/flow/codePreview.ts
examples/recorder-crx/src/flow/exportSanitizer.ts
examples/recorder-crx/src/flow/stepStability.test.ts
```

Acceptance:

```text
diagnostics off by default
diagnostics not exported
diagnostics compact/redacted
diagnostics explain replay decisions
```

---

### Business Repo PR: terminal-state friendly pilot hooks

Branch:

```bash
feat/mvp-017-business-terminal-state-hooks
```

Goal:

```text
Ensure pilot pages expose stable generic hooks to assert row state, overlay state, selected value, and validation.
```

Likely categories:

```text
business wrapper components
pilot pages for IP Pools / WAN transport / SNAT-DNAT / TrafficClass
business tests or smoke checks
```

Acceptance:

```text
pilot flows expose stable row keys / field names / overlay ids
no secrets in attributes
business build/test commands pass
```

## 2. Commit groups for plugin PR 2

```text
1. test: preserve replay negative regressions
2. fix: harden select option final emission
3. fix: scope duplicate row actions by semantic table/row context
4. fix: scope popconfirm confirmation to visible popover
5. feat: add terminal-state assertion suggestions
6. test: add realistic CRX terminal-state coverage
```

## 3. Acceptance gates

### Gate A — Flow/unit

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Gate B — Focused CRX

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/humanLikeRecorder.spec.ts \
  -g "runtime replay supports wait inserted|shared WAN duplicate row edit action|WAN2 transport delete" \
  --project=Chrome --workers=1 --reporter=line --global-timeout=420000
```

### Gate C — Sequential CRX smoke

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  tests/crx/businessFlowRecorder.spec.ts tests/crx/humanLikeRecorder.spec.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=900000
```

### Gate D — Full regression

```bash
xvfb-run -a npx playwright test -c tests/playwright.config.ts \
  --project=Chrome --workers=1 --reporter=line --global-timeout=1200000
```

### Gate E — Build/static

```bash
npm run build
npm run build:crx
git diff --check
```

## 4. Coordination if repos cannot merge together

If downstream business repo cannot merge with plugin PR:

```text
Plugin PR must keep generic fixture coverage independent of downstream app.
Business PR must provide attribute contract and manual/smoke evidence.
Joint validation can use local branches together but must not hardcode plugin behavior to downstream paths.
```

Plugin should degrade when business hints are absent:

```text
business hints → AntD/Pro semantics → DOM/ARIA → weak fallback
```

## 5. What not to include in PRs

Do not include:

```text
Native Messaging
Node Runner
Spec generation
AI scoring dashboard
Storybook/CT corpus
Broad downstream migration beyond pilot
Networking-specific plugin rules
```
