/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { BusinessFlow } from '../flow/types';
import { generateBusinessFlowPlaybackCode as renderParserSafePlaybackCode } from './exportedRenderer';

export function generateBusinessFlowPlaybackCode(flow: BusinessFlow) {
  return renderParserSafePlaybackCode(flow);
}
