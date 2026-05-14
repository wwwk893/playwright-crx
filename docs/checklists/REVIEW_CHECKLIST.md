# MVP 0.1.7 Review Checklist

## 1. Scope checklist

```text
Does this PR only target MVP 0.1.7 replay hardening?
Does it avoid MVP 0.2 Runner / spec generation?
Does it avoid Native Messaging?
Does it avoid broad downstream wrapper migration?
Does it avoid hardcoded networking/WAN/IP Pools production logic?
```

## 2. Replay quality checklist

```text
Select placeholders are not emitted as option clicks.
Repeat/parameter substitution cannot reintroduce unsafe placeholders.
Duplicate row action test ids are scoped by table/row/container.
Popconfirm confirm uses visible popover scope.
Overlay root test ids are not clicked as action controls.
Row matching is tokenized or key-based, not exact whitespace-only.
Generated code remains parser-safe.
Runtime playback code remains equivalent to review/export code where expected.
```

## 3. Terminal-state assertions checklist

```text
Create flow proves row appears or row count changes.
Edit flow proves modal opens and/or row value changes.
Delete flow proves popconfirm closes and row disappears.
Select flow proves selected value/tag visible.
Modal submit proves modal closes.
Validation flow proves error visible.
Assertions fail if business terminal state is absent.
```

## 4. Negative regression checklist

Keep or add tests for:

```text
placeholder text clicked as option -> must fail
row action emitted as global test id -> must fail
Popconfirm OK emitted as tooltip click -> must fail
modal still open after submit -> must fail
row not removed after delete -> must fail
semantic disabled path still works
unknown DOM remains weak/unknown
```

Do not delete negative tests to make the suite pass.

## 5. Privacy checklist

```text
No raw DOM in export/AI/diagnostics.
No rawAction/sourceCode in AI input.
No locatorHints/reasons in compact exports.
No rowText full value in compact exports or AI input.
No overlay.text full value in compact exports or AI input.
No raw option values in compact exports or AI input.
No cookies/tokens/passwords/auth headers/API keys/private keys/connection strings.
Full URL query/hash removed before AI input.
Diagnostics default off.
Diagnostics not exported.
```

## 6. Generalization checklist

```text
No production logic uses strings like WAN/IP Pool/SNAT/DNAT/networking.
Fixture names may appear only in tests/fixtures.
Business hints are consumed generically.
AntD/ProComponents semantics remain fallback after business hints.
Generic DOM/ARIA fallback remains available.
Weak fallback is diagnosed, not silently treated as high confidence.
```

## 7. Test realism checklist

```text
CRX E2E uses real AntD/ProComponents fixture pages.
No replacement with hand-written DOM mocks for main acceptance.
Unit tests are allowed for helper functions but cannot replace CRX E2E.
No blind sleeps.
Tests use human-like interactions where relevant.
Focused tests plus full CRX regression pass.
```

## 8. Commands checklist

PR author should paste:

```bash
npm run test:crx:business-flow:l1
npm run build:examples:recorder
npm run build:tests
npm run test:crx:business-flow:l2 -- --reporter=line --global-timeout=1200000
npm run test:crx:business-flow:l3 -- --reporter=line --global-timeout=1200000
CI=1 npm run test:crx:business-flow -- --reporter=line --global-timeout=1200000
CI=1 npm run test:crx:legacy-core -- --reporter=line --global-timeout=1200000
npm run build
npm run build:crx
git diff --check
```

## 9. Review questions

Ask:

```text
What terminal state does this replay prove?
What happens if the target row is absent?
What happens if there are duplicate test ids?
What happens if the select value is a placeholder?
Can this diagnostic leak business data?
Can this behavior work outside networking fixtures?
```
