/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { StepContextSnapshot } from '../flow/pageContextTypes';
import type { FlowTarget } from '../flow/types';

export type InputTransactionCommitReason = 'change' | 'blur' | 'next-action' | 'stop-recording';

export interface InputTransaction {
  id: string;
  type: 'input';
  targetKey: string;
  targetAliases?: string[];
  field: {
    testId?: string;
    label?: string;
    name?: string;
    placeholder?: string;
  };
  target?: FlowTarget;
  context?: StepContextSnapshot;
  contextEventId?: string;
  sourceEventIds: string[];
  sourceActionIds: string[];
  finalValue: string;
  commitReason: InputTransactionCommitReason;
  startedAt: number;
  endedAt: number;
}

export interface InputTransactionComposition {
  inputTransactions: InputTransaction[];
  openInputTransactions: InputTransaction[];
}
