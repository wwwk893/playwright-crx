/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { BusinessFlow } from './types';

export function prepareBusinessFlowForExport(flow: BusinessFlow, code?: string): BusinessFlow {
  const artifacts = { ...flow.artifacts };
  delete artifacts.deletedStepIds;
  delete artifacts.deletedActionIndexes;
  delete artifacts.deletedActionSignatures;
  delete artifacts.stepActionIndexes;
  delete artifacts.stepMergedActionIndexes;
  delete artifacts.recorder;
  return {
    ...flow,
    artifacts: {
      ...artifacts,
      playwrightCode: code,
    },
    updatedAt: new Date().toISOString(),
  };
}
