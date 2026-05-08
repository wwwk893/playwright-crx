# MVP 0.1.6 Review Checklist

## 1. PR scope checklist

```text
Only MVP 0.1.6 work is included.
No recipe → Playwright preview helper/codegen.
No Storybook / Playwright CT corpus.
No AI scoring dashboard.
No Flow → Spec / Runner / Native Messaging / CI automation.
No Playwright recorder/player rewrite.
No third-party AntD helper runtime dependency.
```

## 2. Business repo review checklist

### E2E ID contract

```text
Existing data-testid values are preserved.
New IDs use lowercase kebab-case.
Rendered primary attribute is data-testid.
Optional semantic metadata uses generic data-e2e-* attributes.
No translated labels are encoded as ids.
No raw user-entered values are encoded as ids.
No secrets/tokens/passwords are encoded as ids or semantic attrs.
```

### Wrapper props

```text
e2eId and e2eIds are optional.
No required prop changes across many callsites.
Wrapper behavior is unchanged when e2eId/e2eIds are absent.
Types are local and minimal.
No business branching logic depends on e2eId.
No e2eId is included in submitted form values.
```

### StrictModal / StrictModalForm

```text
Modal root receives stable test id.
OK button can receive stable test id.
Cancel button can receive stable test id.
Existing modalProps / okButtonProps / cancelButtonProps are preserved.
onFinish/onOk/onCancel behavior unchanged.
```

### Select / Cascader wrappers

```text
Trigger/root receives stable test id.
Popup/option ids are optional and safe.
Option IDs do not include sensitive raw values.
value/onChange behavior unchanged.
```

### Table wrappers

```text
Table root has stable test id.
Rows have static data-testid plus data-row-key.
Toolbar/create/search/batch/pagination regions can be identified.
Row actions keep existing test ids or receive new stable ids.
VirtualTable rows remain identifiable after scrolling if used.
```

### Pilot pages

```text
IP Port Pool pilot has table/create/modal/form/select/row contracts.
DNAT/SNAT pilot has search/create/row actions and tooltip trigger coverage.
TrafficClass pilot, if included, has EditableProTable and DeviceWan contracts.
```

## 3. Plugin repo review checklist

### Generic business hint consumption

```text
Plugin reads data-testid, data-test-id, data-e2e compatibly.
Plugin reads data-e2e-component generically.
Plugin reads data-e2e-field-name / data-e2e-field-kind generically.
Plugin reads data-e2e-table / data-row-key generically.
Plugin reads data-e2e-action generically.
No networking-specific string is hardcoded.
No site-ip-port-pool / WAN / SNAT / DNAT domain logic is added.
```

### Fallback order

```text
business hints win over AntD/ProComponents class fallback.
AntD/ProComponents class fallback still works without business hints.
Generic DOM/ARIA fallback still works.
Unknown DOM remains library=unknown, component=unknown.
```

### Feature flags

```text
semanticAdapterEnabled=false prevents business hints from writing ui.
semanticAdapterDiagnosticsEnabled still defaults false.
Disabled mode has test coverage.
```

## 4. Security / privacy checklist

```text
No credentials or raw secrets are quoted in code comments/docs/tests.
No raw rowText is exported.
No overlay.text is exported.
No option.value is exported.
No locatorHints/reasons are exported.
No full URL query/hash is included in AI input.
No rawAction/sourceCode is included in AI input.
Diagnostics remain compact and local.
Business hints are sanitized before compact YAML / AI input.
```

## 5. Generalization checklist

```text
Works on generic business hint fixture, not just networking.
Fixture names are neutral: pilot-table / pilot-field etc.
Adapter logic depends on data attributes and component types, not route names.
IDs are preserved but not parsed for domain semantics.
ProComponents detection remains useful without business hints.
```

## 6. Cross-repo handoff checklist

Before opening plugin PR:

```text
Business repo PR documents exact IDs added.
Business repo PR lists wrapper props added.
Business repo PR has screenshots or DOM snippets for pilot pages.
Plugin PR test fixture mirrors the generic attributes, not exact business text.
Both PRs agree on data-testid and data-e2e-* contract.
```

If repos cannot be merged together:

```text
Plugin PR must pass without business repo changes.
Business repo PR must be safe even if plugin ignores new attributes.
Pilot validation happens after both are available in a test environment.
```

## 7. Tests checklist

### Business repo

```text
Shared e2eTestId utility tests pass.
Wrapper passthrough tests pass.
Pilot DOM checks pass.
No visual/business behavior changes.
```

### Plugin repo

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
npm run build:tests
xvfb-run -a npx playwright test -c tests/playwright.config.ts tests/crx/semanticAdapter.spec.ts --project=Chrome --workers=1 --reporter=line --global-timeout=300000
npm run build:crx
git diff --check
```

### False-green guard

```text
Tests assert semantic output, not only click count.
Tests assert terminal state for pilot replay where applicable.
No blind sleeps.
No mocks replacing real CRX fixture.
```

## 8. Not-doing-later-MVP checklist

Make sure PR comments do not ask the implementer to sneak in:

```text
Recipe helper codegen, MVP 0.1.7.
Storybook / CT corpus, MVP 0.1.8.
AI scoring dashboard, MVP 0.1.9.
Runner / Native Messaging / spec generation, MVP 0.2.
```
