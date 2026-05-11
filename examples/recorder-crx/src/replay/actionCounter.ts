/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow } from '../flow/types';
import { countBusinessFlowPlaybackActions as countParserSafePlaybackActions } from './exportedRenderer';

export function countBusinessFlowPlaybackActions(flow: BusinessFlow) {
  return countParserSafePlaybackActions(flow);
}
