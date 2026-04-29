/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */

export type IntentSource = 'rule' | 'ai' | 'user';

export interface StepContextSnapshot {
  eventId: string;
  actionIndex?: number;
  capturedAt: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}

export interface PageContextSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];
  activeTab?: TabContext;
  dialog?: DialogContext;
  section?: SectionContext;
  table?: TableContext;
  form?: FormContext;
  target?: ElementContext;
  nearbyText?: string[];
}

export interface PageContextAfterSnapshot {
  url?: string;
  title?: string;
  breadcrumb?: string[];
  activeTab?: TabContext;
  dialog?: DialogContext;
  toast?: string;
}

export interface ElementContext {
  tag?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  text?: string;
  placeholder?: string;
  selectedOption?: string;
  normalizedText?: string;
}

export interface DialogContext {
  type: 'modal' | 'drawer' | 'popover' | 'dropdown';
  title?: string;
  visible: boolean;
}

export interface SectionContext {
  title?: string;
  kind?: 'card' | 'panel' | 'section' | 'fieldset' | 'page';
  testId?: string;
}

export interface TableContext {
  title?: string;
  testId?: string;
  rowKey?: string;
  rowText?: string;
  columnName?: string;
  headers?: string[];
}

export interface FormContext {
  title?: string;
  label?: string;
  name?: string;
  required?: boolean;
}

export interface TabContext {
  title?: string;
  key?: string;
}

export interface IntentSuggestion {
  text: string;
  confidence: number;
  source: 'rule' | 'ai';
  ruleHint?: string;
  provider?: string;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  usageRecordId?: string;
  reason?: string;
  provenance?: IntentProvenance[];
}

export interface IntentProvenance {
  field: string;
  value: string;
}

export interface PageContextEvent {
  id: string;
  tabId?: number;
  kind: 'click' | 'input' | 'change' | 'keydown' | 'navigation';
  time: number;
  wallTime?: number;
  before: PageContextSnapshot;
  after?: PageContextAfterSnapshot;
}
