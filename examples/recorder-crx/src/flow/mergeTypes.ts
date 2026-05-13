/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export type MergeActionsOptions = {
  insertAfterStepId?: string;
  insertBaseActionCount?: number;
  appendNewActions?: boolean;
  recordingSessionId?: string;
  diagnostics?: (event: MergeDiagnosticEvent) => void;
};

export type MergeDiagnosticEvent = {
  level?: 'info' | 'warn';
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export function emitMergeDiagnostic(options: Pick<MergeActionsOptions, 'diagnostics'> | undefined, type: string, message: string, data?: Record<string, unknown>, level: MergeDiagnosticEvent['level'] = 'info') {
  options?.diagnostics?.({ type, message, data, level });
}
