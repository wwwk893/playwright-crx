# Playwright CRX Side Panel Redesign Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan task-by-task. Use `open-design-craft` and `docs/design/playwright-crx-side-panel-redesign.md` as the visual source of truth. Use strict TDD for behavior changes and systematic debugging for any test/E2E failure.

**Goal:** Rebuild the Playwright CRX business-flow side panel to match the refined Open Design prototype: flow-library first, explicit recording flow context, explicit assertion step context, inspectable AI Intent usage, concrete create/edit flow forms, grouped settings, and export review as a quality gate.

**Architecture:** Keep existing recorder/player/business-flow data model and persistence. Refactor the UI into smaller React components under `examples/recorder-crx/src/components/` and a tokenized CSS layer in `crxRecorder.css`. Do not touch Playwright core/server internals unless a failing test proves it is necessary.

**Tech Stack:** React + TypeScript, existing CSS, existing IndexedDB/storage helpers, existing CRX E2E tests.

---

## Pre-flight

- Branch: `feat/side-panel-redesign`.
- Baseline already checked: `npm run build:examples:recorder` passes on `bf3c547` before implementation.
- Do not commit local artifacts: `plugin-stability-e2e.mp4`, `proform-fields-e2e.mp4`, `tests/.raw-generated-replay/`.

## Task 1: Add repo-local design handoff document

**Objective:** Put exact colors, typography, dimensions, and interaction principles inside the Playwright repo so future agents do not rely on memory or external Open Design state.

**Files:**
- Create: `docs/design/playwright-crx-side-panel-redesign.md`

**Steps:**
1. Copy/summarize the Open Design handoff from `/root/app/open-design/.od/projects/playwright-crx-ui-redesign-codex-gpt55-high/DESIGN-HANDOFF.md`.
2. Keep exact token values and component map.
3. Verify with `read_file` and `git diff --check`.

**Expected verification:** document includes `--primary: #3B82F6`, `width: 560px`, `FlowSelectionGuard`, and `AssertionStepContextCard`.

## Task 2: Tokenize the side-panel CSS foundation

**Objective:** Convert `crxRecorder.css` to use the canonical design tokens without changing behavior.

**Files:**
- Modify: `examples/recorder-crx/src/crxRecorder.css`

**Steps:**
1. Add `:root` tokens from design handoff.
2. Update `.business-flow-panel` to canonical side-panel shell (`560px`, white surface, strong border, scroll body discipline).
3. Replace default indigo/purple/AntD blue where applicable with `--primary` family.
4. Keep legacy non-business recorder styles intact.

**Verification:**
- `npm run build:examples:recorder`
- Search CSS for forbidden colors `#1677ff`, `#7c3aed`, `#ede9fe` in business-flow UI and replace unless semantically justified.

## Task 3: Add stage navigation and status shell

**Objective:** Replace the old implicit `setup/recording/review/editRecord` navigation with explicit stage tabs: `流程库 / 录制 · flow / 断言 / 设置 / 导出` while preserving existing behavior.

**Files:**
- Modify: `examples/recorder-crx/src/crxRecorder.tsx`
- Create/Modify components as needed under `examples/recorder-crx/src/components/`

**Steps:**
1. Extend `PanelStage` to include design stages: `library`, `recording`, `assertion`, `settings`, `export`, with transitional compatibility if needed.
2. Add `SidePanelStageNav` component.
3. Add top status copy that reflects current stage and context.
4. Ensure default remains `library`.

**TDD/verification:**
- Add/update focused E2E or component-visible assertions for default `业务流程记录` and nav labels.
- Run focused business-flow UI test if available; otherwise build plus manual browser QA later.

## Task 4: Flow library home and real flow forms

**Objective:** Match the default `流程库` screen and replace separate setup/edit pages with `FlowFormSheet` create/edit sheets.

**Files:**
- Modify: `FlowLibraryPanel.tsx`
- Create: `FlowFormSheet.tsx`
- Modify: `crxRecorder.tsx`
- Modify: `crxRecorder.css`

**Steps:**
1. `FlowLibraryPanel` shows search/filter, AI compact card, flow cards, footer, and buttons matching prototype.
2. `+ 新建流程` opens a sheet instead of immediately navigating to setup page.
3. `编辑` opens `编辑流程：{name}` sheet with prefilled fields.
4. `保存并开始录制` creates/selects the flow and starts recording; `仅保存草稿` saves without recording.
5. Existing import/delete/duplicate/export-all behavior remains.

**TDD/verification:**
- Test new flow sheet opens and contains `流程名称`, `应用 / 模块`, `保存并开始录制`.
- Test edit sheet shows selected flow name.
- Build.

## Task 5: AI Intent usage drawer/sheet

**Objective:** Make `用量` a contextual sheet/drawer, not a full unrelated page.

**Files:**
- Modify or replace: `AiUsagePanel.tsx`
- Modify: `FlowLibraryPanel.tsx`, `crxRecorder.tsx`, CSS

**Steps:**
1. Render usage as `AI Intent 用量` sheet over the current stage.
2. Show today requests/cost, provider/model, recent records, local/desensitization note.
3. Keep export/clear actions.
4. `打开 AI 设置` navigates to settings stage.

**Verification:** build and UI assertion for `AI Intent 用量` sheet after clicking `用量`.

## Task 6: Recording context and guard

**Objective:** Recording must be bound to selected flow; no global recording ambiguity.

**Files:**
- Create: `RecordingFlowContextBar.tsx`
- Create: `FlowSelectionGuard.tsx`
- Modify: `crxRecorder.tsx`, CSS

**Steps:**
1. Recording stage title becomes `录制 · {flowName}`.
2. Show context: flow name, module/page, role, priority, step/assertion counts, next step id.
3. If no flow/name exists, show `FlowSelectionGuard` and block start.
4. Add `切换流程` action back to library/switch affordance.
5. Continue/insert recording behavior remains unchanged.

**TDD/verification:**
- Test no selected/unnamed flow cannot start recording.
- Test selected flow recording page includes `不是全局录制`.

## Task 7: Assertion workbench with step context

**Objective:** Move from inline full assertion editor per step to dedicated `AssertionWorkbench` with explicit selected-step context.

**Files:**
- Create: `AssertionWorkbench.tsx`
- Create: `AssertionStepContextCard.tsx`
- Modify: `StepEditor.tsx`, `StepList.tsx`, `crxRecorder.tsx`, CSS

**Steps:**
1. `StepEditor` becomes lightweight: step id/action/subject, intent/comment, assertion chips, `添加断言` entry.
2. Clicking `添加断言` sets `editingAssertionStepId` and navigates to `assertion` stage.
3. `AssertionWorkbench` renders `AssertionEditor` for the selected step only.
4. Context card includes step id/action/page/target/recommendation source.
5. Save button copy must include `保存到 {stepId}`.

**TDD/verification:**
- Test clicking add assertion shows `Step Context：{stepId}`.
- Test save attaches assertion to that step.
- Build.

## Task 8: Settings accordion and export review stage

**Objective:** Settings and export become explicit stages matching design.

**Files:**
- Modify: `AiIntentSettingsPanel.tsx`
- Create/Modify: `SettingsAccordionPanel.tsx`, `ExportReviewPanel.tsx`
- Modify: `FlowReviewPanel.tsx` if needed
- Modify: `crxRecorder.tsx`, CSS

**Steps:**
1. Settings stage groups recording preferences, AI Intent, privacy/export; only high-frequency group open by default.
2. Export stage shows P0/P1/OK items, redaction state, missing assertions, replay CTA, format buttons, and code preview disclosure.
3. Existing JSON/YAML export functions remain the source of truth.

**TDD/verification:**
- UI test for export review warnings when missing assertions.
- Build.

## Task 9: Visual QA and E2E stabilization

**Objective:** Verify design adherence and no business-flow regression.

**Commands:**
```bash
source /root/.nvm/nvm.sh && nvm use 24.14.0 >/dev/null
npm run build:examples:recorder
npm run build:tests
npm run test:flow --prefix examples/recorder-crx
npm run test:crx:business-flow -- --reporter=line --global-timeout=900000
```

If major server/root code is touched, also run:
```bash
npm run build:crx
npm run test:crx:all -- --reporter=line --global-timeout=1800000
```

**Visual QA:**
- Browser screenshot of default library.
- Screenshot of new flow sheet.
- Screenshot of recording context.
- Screenshot of assertion step context.
- Screenshot of export review.

## Task 10: Final review and handoff

**Objective:** Ensure implementation matches spec and is maintainable.

**Steps:**
1. Spec review against `docs/design/playwright-crx-side-panel-redesign.md`.
2. Code quality review.
3. Run `git diff --check` and final builds/tests.
4. Summarize changed files, root decisions, verification, known limits.
