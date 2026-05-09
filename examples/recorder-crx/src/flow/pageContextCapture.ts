/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import type { PageContextEvent } from './pageContextTypes';

export function isPageContextEventWithinCapture(event: PageContextEvent, captureStartedAt?: number) {
  if (!Number.isFinite(captureStartedAt) || !captureStartedAt)
    return true;
  if (typeof event.wallTime !== 'number')
    return true;
  return event.wallTime >= captureStartedAt;
}

export function filterPageContextEventsForCapture(events: PageContextEvent[], captureStartedAt?: number) {
  if (!Number.isFinite(captureStartedAt) || !captureStartedAt)
    return events;
  return events.filter(event => isPageContextEventWithinCapture(event, captureStartedAt));
}
