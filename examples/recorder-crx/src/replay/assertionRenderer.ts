/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow } from '../flow/types';
import { generateAssertionCodePreview as renderAssertionCodePreview } from './exportedRenderer';

export function generateAssertionCodePreview(flow: BusinessFlow) {
  return renderAssertionCodePreview(flow);
}
