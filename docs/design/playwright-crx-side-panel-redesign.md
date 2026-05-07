# Playwright CRX Side Panel Redesign — Design Handoff

> **Status:** Approved for implementation by user after design review. Future agents must match this document and the Open Design prototype before making visual deviations.
>
> **Canonical prototype:** `/root/app/open-design/.od/projects/playwright-crx-ui-redesign-codex-gpt55-high/index-refined.html`
>
> **Open Design project:** `playwright-crx-ui-redesign-codex-gpt55-high`
>
> **Raw preview:** `http://10.66.66.1:17573/api/projects/playwright-crx-ui-redesign-codex-gpt55-high/raw/index-refined.html?v=1778063705938`

## Goal

Rebuild the Playwright CRX recorder side panel to match the refined Open Design prototype exactly in structure, density, color, typography, and interaction intent.

The design is not a generic dashboard. It is a **Chrome extension side panel** for business-flow recording, assertion authoring, settings, and export review. Every risky action must be tied to explicit context:

- recording is tied to a selected flow record;
- assertion editing is tied to a specific step;
- AI Intent usage is inspectable;
- create/edit flows have real forms;
- export is a review/checkpoint, not just a button.

## Non-negotiable design principles

1. **Side panel first.** Keep the working surface at approximately `560px × 880px`. Do not turn it into a wide SaaS dashboard.
2. **Context before action.** Buttons like `录制`, `保存断言`, `导出` must show which flow/step/export state they affect.
3. **Flow records are first-class.** The default screen is `流程库`, not an active recorder.
4. **Assertions belong to steps.** The assertion workbench must show `Step Context：step-003 · 点击` or equivalent before editing fields.
5. **Recording is never global.** If no flow is selected, show a guard and require selecting/creating a flow first.
6. **Low ornament, high utility.** Prefer sharp hierarchy, compact cards, and calm neutrals over gradients, emoji icons, or decorative blobs.
7. **Exact visual continuity.** Use the color/font/spacing tokens below instead of inventing a new theme.
8. **No fake completeness.** If a data source is not wired yet, show honest local/draft wording rather than fake live metrics.

## Canonical visual tokens

```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-subtle: #f9fafb;
  --fg: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
  --border-strong: #cfd8e3;
  --primary: #3B82F6;
  --primary-strong: #2563eb;
  --primary-soft: #eff6ff;
  --success: #16A34A;
  --success-soft: #e8f7ee;
  --warning: #D97706;
  --warning-soft: #fff7ed;
  --danger: #DC2626;
  --danger-soft: #fef2f2;

  --font-display: Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-body: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: Inconsolata, "SFMono-Regular", Consolas, ui-monospace, monospace;
}
```

### Token roles

| Token | Role | Usage |
|---|---|---|
| `--bg #f8fafc` | page backdrop | Outside side panel / preview shell |
| `--surface #ffffff` | primary surface | Side panel, cards, sheets, buttons |
| `--surface-subtle #f9fafb` | secondary surface | Hover, toolbar, nested sections, input background |
| `--fg #111827` | primary text | Headings, important labels, main content |
| `--muted #6b7280` | secondary text | helper copy, timestamps, metadata |
| `--border #e5e7eb` | soft divider | internal card borders and separators |
| `--border-strong #cfd8e3` | control border | side panel frame, buttons, inputs |
| `--primary #3B82F6` | main action | active tab, primary CTA, focus logic |
| `--primary-strong #2563eb` | active/pressed action | hover/active primary CTA |
| `--primary-soft #eff6ff` | subtle selected state | active chip, selected workflow context |
| `--success #16A34A` | positive status | verified/replay ok/local saved |
| `--success-soft #e8f7ee` | success background | success chips/cards |
| `--warning #D97706` | warning status | P1/export warnings, missing assertions |
| `--warning-soft #fff7ed` | warning background | warning chips/cards |
| `--danger #DC2626` | destructive/error | delete, P0 failures |
| `--danger-soft #fef2f2` | danger background | P0 cards/error sheets |

### Color restrictions

- Do not introduce Tailwind indigo/purple defaults (`#6366f1`, `#4f46e5`, `#8b5cf6`, etc.).
- Do not add generic AI blue-purple gradients.
- Accent usage must stay sparse: one active tab, one primary CTA, one contextual selected surface per screen is enough.
- Status colors are semantic only; do not use red/orange/green as decorative accents.

## Typography

- Display / headings: `Poppins` stack.
- Body / UI text: `Roboto` stack.
- Code / paths / step ids: `Inconsolata` stack.

For the Chrome extension implementation, prefer bundled/local fonts if already allowed by the build. If not, use the fallback stack; do **not** load external web fonts at runtime from the extension without reviewing CSP and privacy impact.

| Role | Size | Line height | Weight | Notes |
|---|---:|---:|---:|---|
| App title | `16px` | `20px` | `600` | compact, not marketing hero |
| Section title | `15px` | `20px` | `600` | e.g. `业务流程记录` |
| Card title | `14px` | `18px` | `600` | flow/step/card names |
| Body | `14px` | `1.45` | `400` | default text |
| Metadata | `12px` | `16px` | `400/500` | stage labels, timestamps, paths |
| Code/path | `12px` | `16px` | `400` | use mono family |
| Pills/chips | `11–12px` | `16px` | `600` | uppercase only if needed |

Letter spacing should stay near zero. Use `0.02em` only for tiny labels/chips when needed.

## Layout and dimensions

```css
.side-panel {
  --footer-safe-space: 132px;
  width: 560px;
  height: 880px;
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 20px 54px rgba(15, 23, 42, 0.16);
}
```

Implementation notes:

- Keep the primary side panel width around `540–580px`; `560px` is canonical.
- Preserve fixed header/stage/status/footer regions and a scrollable body.
- The scroll body must include bottom padding equal to at least `--footer-safe-space` so the sticky footer never hides the last step/card.
- The footer safe space was intentionally raised from `88px` to `132px` after visual QA.

### Spacing scale

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | `4px` | chip gaps, icon nudges |
| `--space-2` | `8px` | compact vertical rhythm |
| `--space-3` | `12px` | card internal gaps |
| `--space-4` | `16px` | section padding |
| `--space-5` | `20px` | major section separation |
| `--space-6` | `24px` | sheet header/body padding max |

### Radius and borders

| Element | Radius | Border |
|---|---:|---|
| Side panel | `10px` | `1px solid --border-strong` |
| Cards/sections | `8px` | `1px solid --border` |
| Buttons/inputs | `6px` | `1px solid --border-strong` |
| Pills/chips | `999px` | semantic/subtle border |
| Sheets | `10–12px` | `1px solid --border-strong` |

### Shadows

- Main side panel only: `0 20px 54px rgba(15, 23, 42, 0.16)`.
- Browser/mock preview frame: `0 16px 40px rgba(15, 23, 42, 0.08)`.
- Avoid stacking shadows on every card.

## Required information architecture

The stage navigation order must remain:

```text
流程库 → 录制 · {flowName} → 断言 → 设置 → 导出
```

### 流程库 stage — default screen

Must include:

- header: `业务流程记录`;
- actions: `+ 新建流程`, `导入 JSON`;
- search: `搜索流程名称、模块或标签`;
- filters: `全部`, `草稿`, `已完成`, `高优先级`;
- compact `AI Intent 全局配置` card;
- `用量` entry that opens usage sheet;
- flow cards with `打开`, `编辑`, `复制`, `删除`;
- footer status and `导出全部`.

### AI Intent 用量 sheet

Must include title `AI Intent 用量`, today's request count/cost, provider/model, recent records, local/desensitization note, `关闭`, `打开 AI 设置`, export and clear actions where available.

### 新建/编辑流程 sheet

Shared fields:

- 流程名称;
- 应用 / 模块;
- 起始 URL or 页面;
- 仓库 / 路径;
- 角色;
- 优先级;
- 标签;
- AI Intent 模式.

New-flow actions: `仅保存草稿`, `保存并开始录制`.

Edit-flow actions: `取消`, `保存修改`.

Edit mode must clearly say which flow is being edited, e.g. `编辑流程：test1`.

### 录制 · {flowName} stage

Required context:

```text
录制 · test1
正在录制：站点配置 / 新增共享 WAN
正在录制：test1
默认使用流程库中当前选中的流程；记录将追加到 step-025，不是全局录制。
```

Must include active flow context card, module/page, role, priority, step/assertion counts, `切换流程`, FlowSelectionGuard empty state, and step timeline cards.

### 断言 stage

Required top status:

```text
断言 · step-003
保存后挂到 step-003 之后
```

Required context card:

```text
Step Context：step-003 · 点击
这条断言会挂到 step-003 之后，用来确认保存动作真的生效。
原动作：点击「保存共享 WAN」
页面：/site/edit/testSharedWan
目标元素：button 保存共享 WAN
推荐来源：StepList 规则 / 表格保存动作
```

Required button copy: `保存到 step-003`.

The old pattern where a full `AssertionEditor` is embedded inside every step card should be replaced with a dedicated workbench. Step cards should show assertion chips / add-assertion entry, not the full form.

### 设置 stage

Use accordion/grouped sections. Default open: high-frequency recording preferences. Default collapsed: AI Intent details, privacy/export details. Secrets must never be shown in plain text.

### 导出 stage

Must include P0/P1/OK review items, Replay CTA, desensitization status, format selector, code preview behind tab/disclosure, and clear blocking/warning wording.

## Component handoff map

| Component | Responsibility |
|---|---|
| `SidePanelStageNav` | Stage tabs |
| `FlowLibraryHome` / existing `FlowLibraryPanel` | Default library screen |
| `AiIntentCompactCard` / existing `GlobalAiIntentCard` | AI summary |
| `UsageDrawer` | AI Intent usage sheet |
| `FlowRecordCard` | Flow card |
| `FlowFormSheet` | Shared create/edit flow form |
| `RecordingFlowContextBar` | Explicit active flow while recording |
| `FlowSelectionGuard` | No selected flow = cannot record |
| `StepTimelineCard` / existing `StepEditor` | Lightweight step/evidence card |
| `AssertionWorkbench` | Dedicated assertion editing surface |
| `AssertionStepContextCard` | Step binding context for assertion page |
| `SettingsAccordionPanel` | Grouped settings/preferences/AI/privacy |
| `ExportReviewPanel` | Export risk review, replay CTA, format/code preview |
| `FlowReviewRiskModel` | Computes P0/P1/OK export checks |

## Implementation guardrails

1. Match `index-refined.html` first; do not restyle freely.
2. Do not weaken existing E2E assertions to fit the redesign.
3. Do not remove business-flow coverage.
4. Keep data model compatibility.
5. Preserve keyboard/accessibility basics.
6. No secrets in UI.
7. No network font dependency without review.
8. Footer cannot cover content.
9. Every ambiguous CTA label must include context.
10. Prototype remains the visual source of truth until implementation PR review.

## Required QA before shipping implementation

Visual QA:

- Open side panel at `560px × 880px`.
- Verify stages: `流程库`, `录制 · test1`, `断言`, `设置`, `导出`.
- Verify sheets: `用量`, `新建流程`, `编辑流程`, `切换流程`.
- Scroll to bottom of recording timeline; final step must be fully visible above footer.

Functional QA:

- Create flow → save draft.
- Create flow → save and start recording.
- Edit existing flow → saved changes update library card.
- Open selected flow → recording stage shows that flow name/module.
- No selected flow → record action is blocked by guard.
- Select step → assertion stage shows correct step id/action/page/target.
- Save assertion → assertion attaches to selected step.
- Export review → P0/P1/OK checks reflect current flow state.

## Current prototype QA evidence

- Assertion page with explicit `step-003`: `/root/.hermes/cache/screenshots/browser_screenshot_cf27f59f57db49858958f84edbde6aea.png`
- New flow form sheet: `/root/.hermes/cache/screenshots/browser_screenshot_c9131acf4fee49189af2e208ade8668a.png`
- Recording page scrolled to bottom, footer not covering final step: `/root/.hermes/cache/screenshots/browser_screenshot_bd62b29f196b4c9aa85133a96eafcce8.png`
