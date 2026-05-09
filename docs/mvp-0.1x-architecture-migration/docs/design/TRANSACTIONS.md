# Interaction Transactions Design

## Purpose

把低层事件归并成用户交互。重点解决输入框 typing/fill/press/change 混乱和 AntD popup option 迟到。

## Types

```ts
export type InteractionTransaction =
  | InputTransaction
  | SelectTransaction
  | ClickTransaction
  | TableRowActionTransaction
  | WaitTransaction;

export interface TransactionBase {
  id: string;
  sessionId: string;
  type: string;
  sourceEventIds: string[];
  sourceActionIds: string[];
  startedAt: number;
  endedAt: number;
}

export interface InputTransaction extends TransactionBase {
  type: 'input';
  targetKey: string;
  field: {
    testId?: string;
    label?: string;
    name?: string;
    placeholder?: string;
  };
  finalValue: string;
  commitReason: 'change' | 'blur' | 'next-action' | 'stop-recording';
}

export interface SelectTransaction extends TransactionBase {
  type: 'select';
  targetKey: string;
  field: {
    testId?: string;
    label?: string;
    name?: string;
  };
  component: 'Select' | 'TreeSelect' | 'Cascader';
  searchText?: string;
  selectedText: string;
  optionPath?: string[];
}
```

## Input rules

- Same targetKey input/fill/press/change merge into one transaction.
- finalValue wins.
- single keydown/press does not become FlowStep.
- Tab/blur commits transaction but does not become FlowStep.
- stop recording commits open transaction.

## Select rules

- trigger click + search fill + option event = one SelectTransaction.
- dropdownContextId or field label binds option to trigger.
- if option missing at finalization, transaction is incomplete and becomes warning, not a fake complete select step.

## Acceptance

- typing `alice` creates one fill FlowStep with value `alice`.
- Select search + option creates one select FlowStep.
- stop recording does not lose last input value.
