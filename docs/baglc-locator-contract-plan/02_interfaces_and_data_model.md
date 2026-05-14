# 02. Interfaces and Data Model

## 1. LocatorContract

```ts
export interface LocatorContract {
  version: 1;
  primary: LocatorCandidate;
  alternatives: LocatorCandidate[];
  grounding?: BusinessActionGroundingEvidence;
  safety: SafetyDecision;
  effectHints: EffectHint[];
  diagnostics?: LocatorContractDiagnostics;
}
```

## 2. LocatorCandidate

```ts
export interface LocatorCandidate {
  id: string;
  kind: LocatorCandidateKind;
  code: string;
  mode: 'exported' | 'parser-safe' | 'diagnostic';
  score: number;
  risk: SafetyRisk;
  scope?: LocatorScope;
  uniqueness?: LocatorUniqueness;
  reasons: string[];
  risks: string[];
  blacklistHits?: string[];
  runtimeBridge?: 'active-popup-option' | 'visible-popconfirm' | 'duplicate-ordinal' | 'none';
}

export type LocatorCandidateKind =
  | 'row-scoped-testid'
  | 'dialog-scoped-testid'
  | 'business-testid'
  | 'role-name-scoped'
  | 'label-control'
  | 'form-item-control'
  | 'active-popup-option'
  | 'visible-popconfirm-confirm'
  | 'text-scoped'
  | 'css-diagnostic'
  | 'xpath-diagnostic'
  | 'nth-diagnostic';
```

## 3. SafetyDecision

```ts
export type SafetyRisk = 'low' | 'medium' | 'high' | 'critical';

export interface SafetyDecision {
  risk: SafetyRisk;
  allowExecute: boolean;
  allowFallback: boolean;
  requiresReview: boolean;
  reasons: string[];
}
```

## 4. BusinessActionGroundingEvidence

```ts
export interface BusinessActionGroundingEvidence {
  rawTarget: AnchorCandidateEvidence;
  chosenAnchor: AnchorCandidateEvidence;
  equivalentAnchors: AnchorCandidateEvidence[];
  candidates: AnchorCandidateEvidence[];
  confidence: number;
  reasons: string[];
}
```

## 5. AnchorCandidateEvidence

```ts
export interface AnchorCandidateEvidence {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  testId?: string;
  dataE2e?: string;
  dataE2eAction?: string;
  depthFromTarget: number;
  source: 'target' | 'composedPath' | 'ancestor' | 'pointed' | 'tableScope' | 'portal';
  ruleScore: number;
  reasons: string[];
  risks: string[];
  bbox?: RectLike;
  context?: {
    formLabel?: string;
    fieldName?: string;
    dialogTitle?: string;
    dialogTestId?: string;
    tableTestId?: string;
    rowKey?: string;
    columnKey?: string;
    proComponent?: string;
  };
}
```

## 6. EffectHint

```ts
export type EffectHint =
  | { kind: 'selected-value-visible'; fieldLabel?: string; value: string }
  | { kind: 'field-value-visible'; fieldLabel?: string; value: string }
  | { kind: 'modal-opened'; title?: string; testId?: string }
  | { kind: 'modal-closed'; title?: string; testId?: string }
  | { kind: 'row-exists'; tableTestId?: string; rowKey?: string; rowText?: string }
  | { kind: 'row-disappears'; tableTestId?: string; rowKey?: string; rowText?: string }
  | { kind: 'toast-visible'; text?: string }
  | { kind: 'popconfirm-closed' };
```

## 7. OverlayPrediction

```ts
export interface OverlayPrediction {
  id: string;
  sourceEventId: string;
  expectedType:
    | 'modal'
    | 'drawer'
    | 'popconfirm'
    | 'select-dropdown'
    | 'tree-select-dropdown'
    | 'cascader-dropdown'
    | 'picker-dropdown';
  owner?: {
    fieldLabel?: string;
    fieldName?: string;
    fieldTestId?: string;
    dialogTitle?: string;
    tableTestId?: string;
    rowKey?: string;
  };
  status: 'pending' | 'resolved' | 'expired' | 'ambiguous';
  resolvedOverlay?: unknown;
  reasons: string[];
}
```
