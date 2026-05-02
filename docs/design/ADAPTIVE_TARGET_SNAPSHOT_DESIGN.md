# MVP 0.1.x Internal Adaptive Target Diagnostics Design

> Status: revised after GPT-5.5 Pro review (`approve_with_changes`).
>
> Scope: design proposal only. This document intentionally does **not** implement code.
>
> Inspiration: Scrapling's adaptive scraping / element relocation idea. The implementation must be a clean TypeScript design for this Playwright CRX recorder. No Scrapling code is copied.

## 1. Goal

Make recorded business flows easier to diagnose when selectors drift after Ant Design / ProComponents UI changes.

The first implementation is **internal adaptive target diagnostics**, not automatic recovery:

- capture a small, redacted target snapshot at record time;
- build scope-aware locator candidates;
- show/debug why a target can or cannot be located;
- fail closed when the primary locator fails.

Non-goals for MVP 0.1.x:

- Do not silently click, fill, check, or select a relocated element.
- Do not modify generated Playwright replay code for adaptive recovery.
- Do not modify `src/server/recorder/crxPlayer.ts` for Phase A-D unless a separate review approves it.
- Do not store full DOM, HTML, `outerHTML`, screenshots, cookies, storageState, request/response bodies, traces, or secrets.
- Do not add AI, Native Messaging, or Node Runner work to MVP 0.1.x.
- Do not import Scrapling or add Python dependencies.

## 2. Why Scrapling is relevant

Scrapling's adaptive feature is useful as a mental model:

1. Save phase: store stable-ish properties of a selected element.
2. Match phase: when the original selector fails, compare current DOM nodes against stored properties and return similarity candidates.

For this project, the useful idea is treating a recorded target as a **redacted, scoped fingerprint** rather than only one selector string.

The mapping here is deliberately conservative:

- record-time `AdaptiveTargetRecord` under the internal recorder sidecar;
- scope-aware `LocatorCandidate[]`;
- review/debug diagnostics first;
- optional strict recovery only after separate review and tests.

## 3. Data model

### 3.1 Storage boundary

Phase A stores adaptive target metadata **only** in the internal recorder sidecar:

```text
BusinessFlow.artifacts.recorder.adaptiveTargets
```

It is keyed by stable refs:

```text
step:${step.id}
assertion:${assertion.id}
```

Hard rules:

- Do not add `targetSnapshot` to `FlowTarget` in Phase A/B.
- Do not expose adaptive metadata in `compact-flow.yaml`.
- Do not include adaptive metadata in default exported `business-flow.json`.
- `prepareBusinessFlowForExport()` must strip `artifacts.recorder`, which includes `adaptiveTargets`.
- `toCompactFlow()` must not render snapshots, candidates, bbox, diagnostic id/class/name, or raw text dumps.
- Only an explicit future internal diagnostic export may include redacted adaptive metadata.

Current repo fit:

- `FlowTarget` already has `scope` and `locatorHint`; keep those as the exported business-facing model.
- `FlowRecorderState` is the correct internal home because `exportSanitizer.ts` already strips `artifacts.recorder`.
- Existing `StepContextSnapshot`, `TableContext`, `RowIdentity`, `FlowTargetScope`, and `LocatorHint` should be reused before adding new DOM collection.

### 3.2 Proposed types

```ts
import type { FlowActionType, FlowTargetScope, LocatorHint } from './types';
import type { RowIdentity, UiControlType, UiFramework } from './pageContextTypes';

export type AdaptiveTargetRef =
  | `step:${string}`
  | `assertion:${string}`;

export interface AdaptiveTargetRecord {
  version: 1;
  ref: AdaptiveTargetRef;
  stepId?: string;
  assertionId?: string;
  action?: FlowActionType;
  capturedAt: string;
  source: 'page-context-sidecar' | 'recorder-action' | 'assertion-picker';
  snapshot: RecordedTargetSnapshot;
  locatorCandidates: LocatorCandidate[];
}

export interface RecordedTargetSnapshot {
  version: 1;

  // Safe structural fields.
  tagName?: string;
  role?: string;
  controlType?: UiControlType;
  framework?: UiFramework;

  // Preferred stable identifiers.
  testId?: string;
  dataE2E?: string;

  // Redacted and bounded text-like fields.
  accessibleName?: string;
  ariaLabel?: string;
  labelText?: string;
  placeholder?: string;
  title?: string;
  normalizedText?: string;

  // Existing compact project context.
  scope?: FlowTargetScope;
  locatorHint?: LocatorHint;

  // First-class table/list identity.
  row?: RowTargetSnapshot;

  // Internal diagnostics only. Not exported by default.
  diagnosticAttributes?: DiagnosticAttributes;

  parent?: SnapshotNeighbor;
  siblings?: SnapshotNeighbor[];

  // Tag names only, max depth.
  domPath?: string[];
  domDepth?: number;

  /**
   * Internal diagnostic only. Not exported. Not used as a click target.
   */
  bbox?: SnapshotBoundingBox;
}

export interface RowTargetSnapshot {
  tableTestId?: string;
  tableTitle?: string;
  rowIdentity?: RowIdentity;
  rowKey?: string;
  rowTextSummary?: string;
  keyCells?: Array<{
    columnName?: string;
    text: string;
  }>;
  columnName?: string;
  actionName?: string;
  actionRole?: string;
  nestingLevel?: number;
  fixedSide?: 'left' | 'right';
  fingerprint?: string;
}

export interface DiagnosticAttributes {
  type?: string;
  name?: string;
  id?: string;
  classTokens?: string[];
  dataRowKey?: string;
}

export interface SnapshotNeighbor {
  tagName?: string;
  role?: string;
  accessibleName?: string;
  normalizedText?: string;
  testId?: string;
}

export interface SnapshotBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LocatorCandidateKind =
  | 'testid'
  | 'data-e2e'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'table-row'
  | 'antd-select-option'
  | 'antd-tree-select-option'
  | 'antd-cascader-option'
  | 'scoped-css'
  | 'xpath';

export interface LocatorCandidate {
  kind: LocatorCandidateKind;
  value: string;
  score: number;
  reason: string;
  scope?: 'page' | 'dialog' | 'section' | 'table' | 'form';
  pageCount?: number;
  scopeCount?: number;
  strict?: boolean;
}
```

`FlowRecorderState` should grow the internal field only:

```ts
export interface FlowRecorderState {
  version: 2;
  actionLog: RecordedActionEntry[];
  nextActionSeq: number;
  nextStepSeq: number;
  sessions: RecordingSession[];

  /** Internal only. Must be stripped by export sanitizer. */
  adaptiveTargets?: Record<AdaptiveTargetRef, AdaptiveTargetRecord>;
}
```

## 4. Privacy and field retention policy

Redaction must run **before storing the snapshot**, not only during export. Drafts, recorder state, review UI, diagnostic logs, and any internal artifact can live long enough to become a privacy risk.

### 4.1 Field retention table

| Field group | Store in draft/recorder state | Default export | Notes |
|---|---:|---:|---|
| `testId` / `dataE2E` | yes | no in Phase A/B | preferred stable identifiers, still internal first |
| `role` / `controlType` / `framework` | yes | no in Phase A/B | structural |
| `label` / `placeholder` / `accessibleName` / `normalizedText` | yes, redacted and truncated | no in Phase A/B | max 80 or 120 chars |
| `scope` / `locatorHint` | yes | existing exported fields only | reuse current model; do not duplicate raw internals |
| table row summary | yes, redacted and truncated | no in Phase A/B | can contain business data |
| `id` / `class` / `name` | internal diagnostics only | no | low-rank and often dynamic/sensitive |
| `bbox` | internal diagnostics only | no | diagnostics only; never a click target |
| `input.value` | no | no | never store |
| `style` / HTML / subtree / screenshot | no | no | forbidden |

### 4.2 Redaction rules

Before storage:

- Redact values whose name/text matches `password|token|secret|authorization|cookie|session|apikey|api-key|credential|bearer`.
- Do not store `input.value` at all.
- Do not store inline event handler attributes.
- Do not store `style`, full `className`, full HTML, `outerHTML`, or full DOM subtree.
- If class information is needed, store at most a small diagnostic `classTokens[]` after filtering dynamic framework tokens.
- Text-like fields are normalized and truncated to a configured max length, initially 80 or 120 chars.
- Row text summary is separately bounded and redacted.
- `bbox` is internal diagnostics only and must not be exported or used as a locator/click target.
- Diagnostic output must also use the same redactor; do not rely on export-only redaction.

## 5. Table/list targets are first-class

Table/list support is not a generic element snapshot afterthought. For current AntD / ProComponents business flows, row identity is often more important than the button locator.

The project already has:

- `TableContext`
- `RowIdentity`
- `FlowTargetScope.table`
- `tableRowExists`
- table-scoped codegen helpers
- L3 E2E around ProTable-style rows/actions

Rules:

- For any step/assertion with `context.before.table`, record `RowTargetSnapshot` first.
- For row actions, ranking should prefer:
  1. table test id + stable row identity + action role/name;
  2. table test id + row keyword + action role/name;
  3. section/dialog scoped table + row keyword;
  4. generic element candidates.
- Do not relocate a row action by button text alone when row context exists. Buttons like `编辑`, `删除`, `查看` are only meaningful inside a row.
- Do not use `tr:nth-child(...)` or coordinate/bbox as recovery strategy.

Example target shape:

```ts
const row = page.getByTestId('users-table')
  .getByRole('row')
  .filter({ hasText: 'alice.qa' });
await row.getByRole('button', { name: '编辑' }).click();
```

This should be represented as a `table-row` candidate, not as a brittle button-only CSS candidate.

## 6. Locator candidate ranking

Candidate ranking is scope-aware and uniqueness-aware. A candidate is not just a locator string; it also needs scope, counts, strictness, and a reason.

Recommended priority:

1. unique `data-testid` / configured test id attribute;
2. unique `data-e2e`;
3. `table-row`: table test id + stable row identity + action role/name;
4. dialog/section scoped role + accessible name;
5. field-scoped label / placeholder;
6. AntD/ProComponents semantic component candidate:
   - Select option;
   - TreeSelect option;
   - Cascader option;
   - trigger label + option text/path;
7. short unique text, only if unique within scope;
8. diagnostic scoped CSS;
9. XPath only as diagnostic fallback.

Example:

```json
[
  {
    "kind": "testid",
    "value": "create-user-btn",
    "score": 100,
    "scope": "section",
    "pageCount": 1,
    "scopeCount": 1,
    "strict": true,
    "reason": "data-testid is present and unique within the section"
  },
  {
    "kind": "role",
    "value": "button:新建用户",
    "score": 90,
    "scope": "section",
    "pageCount": 3,
    "scopeCount": 1,
    "strict": true,
    "reason": "button role/name is unique inside section[data-testid=user-admin-card]"
  }
]
```

CSS/XPath candidates are kept for diagnostics, not encouraged as the primary path.

## 7. Similarity scoring and hard filters

Hard filters run before scoring:

- `fill` only matches input/textarea/contenteditable/combobox-like elements.
- `click` must match visible, enabled, interactable candidates.
- `check/uncheck` must match checkbox/radio/switch-like candidates.
- table-row actions must stay inside the same table candidate if table context exists.
- dropdown option candidates must match the original component type.
- password/token-like targets never auto-recover.
- hidden, disabled, or ambiguous candidates fail closed unless the original action is explicitly non-interactive.

Candidate-specific scoring sketch:

```ts
score =
  50 * uniqueTestIdMatch +
  35 * sameTableRowIdentity +
  25 * scopedRoleNameMatch +
  20 * labelOrPlaceholderMatch +
  15 * componentTypeMatch +
  10 * accessibleTextSimilarity +
  8  * parentScopeSimilarity +
  5  * siblingSimilarity +
  3  * diagnosticAttributeSimilarity;
```

`testId` / `data-e2e` uniqueness should be strongly preferred in this project. Diagnostic attributes like `id`, `class`, and `name` are intentionally low-rank because they can be dynamic, business-specific, or sensitive.

## 8. Replay-time behavior

### 8.1 Phase 1: diagnostics only

Phase 1 must not modify generated Playwright code and must not click/fill/check/select a relocated element.

When the primary locator fails, diagnostics may be shown in:

- business-flow review UI;
- recorder diagnostic log;
- optional internal diagnostic export.

The exported replay code must still fail when the primary locator fails.

Example diagnostic:

```text
Primary locator failed: page.getByTestId("create-user-btn")
Adaptive target candidates:
  91% role button[name="新建用户"] inside section[data-testid="user-admin-card"]
  73% scoped-css button.ant-btn-primary near redacted section text
Decision: diagnostics only; no automatic click was performed.
```

### 8.2 Resume/F8 integration boundary

Do not touch `src/server/recorder/crxPlayer.ts` in the initial diagnostics work.

If diagnostics are later surfaced in Resume/F8 call-log, that must be a separate reviewed change with tests proving:

- parser-safe playback remains stable;
- playback action counting is unchanged;
- call-log marker order remains deterministic;
- diagnostics only appear on primary locator failure, not every step.

### 8.3 Optional strict recovery, later only

Strict recovery is not part of Phase A-D. It requires a separate review.

If it is ever added, it must be behind an explicit flag:

```ts
adaptiveRecovery: 'off' | 'diagnose' | 'strict';
```

Requirements before strict mode exists:

- confidence >= 90 or a reviewed threshold;
- exactly one top candidate after tie-breaking;
- candidate role/control type matches original action;
- candidate is visible/enabled/editable as required;
- candidate passes sensitive-target hard filters;
- recovery event is logged and attached;
- ambiguous and low-confidence cases fail closed;
- generated CI specs do not default to strict recovery.

## 9. Implementation phases

### Phase A: internal data model + redaction + export stripping

Files likely touched:

- `examples/recorder-crx/src/flow/adaptiveTargetTypes.ts` new
- `examples/recorder-crx/src/flow/adaptiveTargetRedactor.ts` new
- `examples/recorder-crx/src/flow/types.ts`
- `examples/recorder-crx/src/flow/exportSanitizer.ts`
- `examples/recorder-crx/src/flow/compactExporter.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

Tests:

- adaptive target records are stored under internal recorder state;
- adaptive snapshot redacts sensitive text and truncates long fields;
- adaptive snapshot never stores input value or authorization-like attributes;
- adaptive snapshot keeps safe test id, role, label, scope, and table context;
- export sanitizer strips internal adaptive target records;
- compact flow YAML does not include adaptive target snapshots or locator candidates.

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build --prefix ./examples/recorder-crx
```

### Phase B: capture snapshot from existing context, no new DOM scan

Files likely touched:

- `examples/recorder-crx/src/flow/adaptiveTargetSnapshot.ts` new
- `examples/recorder-crx/src/flow/flowContextMerger.ts`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

Rules:

- First version only uses existing `StepContextSnapshot`, `FlowTarget.scope`, `LocatorHint`, `ElementContext`, `TableContext`, and `FormContext`.
- Do not ask content scripts to collect full DOM or screenshots.
- Store under `artifacts.recorder.adaptiveTargets[ref]`.

Tests:

- adaptive snapshot captures test id, role, form label, dialog, and table row identity from page context;
- adaptive snapshot for table row action stores `RowTargetSnapshot`;
- assertion targets can create `assertion:${assertion.id}` records without changing `FlowTarget`.

Command:

```bash
npm run test:flow --prefix examples/recorder-crx
```

### Phase C: locator candidates + review UI diagnostics

Files likely touched:

- `examples/recorder-crx/src/flow/locatorCandidates.ts` new
- `examples/recorder-crx/src/components/FlowReviewPanel.tsx`
- `examples/recorder-crx/src/flow/stepStability.test.ts`

Rules:

- Build candidates and reasons.
- Display a small, redacted diagnostic summary in review UI.
- Do not provide “use this candidate to replace locator” in the first UI version.
- Do not change generated Playwright code.

Tests:

- locator candidates rank unique test id above role and text;
- locator candidates prefer table row candidate for row action;
- locator candidates reject repeated global text without scope;
- locator candidates include AntD select/tree/cascader semantic candidate when existing context supports it;
- candidates include reason and scope counts.

Commands:

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build --prefix ./examples/recorder-crx
```

### Phase D: diagnostics-only failure reporting, delayed

Do this after Phase A-C has been reviewed in actual usage.

Rules:

- Report candidates when the primary locator fails.
- Do not click/fill/check/select candidates.
- Do not touch `src/server/recorder/crxPlayer.ts` or generated code in the first diagnostics-only implementation.

Tests:

- primary locator failure reports candidates but does not click;
- ambiguous candidates fail closed;
- sensitive candidate text is redacted in diagnostics.

### Phase E: optional strict recovery, separate review

Strict recovery is out of current scope. It requires new L3 E2E and explicit owner approval.

## 10. What not to implement yet

Do not implement these until a later reviewed phase:

1. automatic clicking/filling/checking/selecting of relocated elements;
2. adaptive recovery in generated Playwright code;
3. modifications to `src/server/recorder/crxPlayer.ts`;
4. full DOM, HTML, screenshot, trace, style, response body, cookie, storageState collection;
5. storage of `input.value`;
6. copied Scrapling code;
7. snapshot/locatorCandidates in `compact-flow.yaml`;
8. CSS/XPath as primary candidates;
9. a `strict` recovery switch before high-confidence, ambiguous, sensitive-target, playback-log, and generated-code non-regression tests exist.

## 11. Open questions for the project owner

1. Should adaptive metadata ever be included in an explicitly requested internal diagnostic export? Default answer: no for public export; maybe yes for internal redacted debug bundles.
2. Can the internal flow draft store redacted row text / normalized text long-term, or should it expire/compact aggressively?
3. Are usernames, IPs, VRF names, and environment names in test data considered sensitive for diagnostic UI?
4. Where should adaptive diagnostics eventually appear first: review UI, diagnostic log, Node Runner, or Resume/F8 call-log?
5. Should `data-testid` remain the primary stable attribute, with `data-e2e` as second, or should the company standard converge on one?
6. For table rows, should the primary identity be `data-row-key`, `RowIdentity.stable`, first key cell text, or row summary? Proposed order: `data-row-key` / stable `RowIdentity` first; redacted row text only as fallback.
7. If diagnostics include business text, what redaction level is acceptable for reviewers?
8. Should Phase C diagnostics be hidden until locator failure, or always visible in collapsed “定位候选” UI?

## 12. Recommendation

Proceed as:

```text
internal sidecar first
redaction before storage
row/list first-class
scope-aware locator candidates
review/debug diagnostics only
fail closed
no default export
no recovery
no player changes
no generated code changes
```

This keeps the design compatible with the current `BusinessFlow.steps`, `StepContextSnapshot`, `FlowTarget.scope`, `LocatorHint`, stable step model, AntD/ProComponents L3 E2E, and legacy player constraints.
