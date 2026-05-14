/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

export interface RectLike {
  x?: number;
  y?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
}

export interface NormalizedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function normalizeRect(rect?: RectLike): NormalizedRect | undefined {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0)
    return undefined;
  const left = numberOr(rect.left, rect.x, 0);
  const top = numberOr(rect.top, rect.y, 0);
  const right = numberOr(rect.right, left + rect.width);
  const bottom = numberOr(rect.bottom, top + rect.height);
  const width = Math.max(0, right - left) || rect.width;
  const height = Math.max(0, bottom - top) || rect.height;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function rectIntersectionArea(leftRect?: RectLike, rightRect?: RectLike) {
  const left = normalizeRect(leftRect);
  const right = normalizeRect(rightRect);
  if (!left || !right)
    return 0;
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function rectIoU(leftRect?: RectLike, rightRect?: RectLike) {
  const left = normalizeRect(leftRect);
  const right = normalizeRect(rightRect);
  if (!left || !right)
    return 0;
  const intersection = rectIntersectionArea(left, right);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function centerContained(outerRect?: RectLike, innerRect?: RectLike) {
  const outer = normalizeRect(outerRect);
  const inner = normalizeRect(innerRect);
  if (!outer || !inner)
    return false;
  const centerX = inner.left + inner.width / 2;
  const centerY = inner.top + inner.height / 2;
  return centerX >= outer.left && centerX <= outer.right && centerY >= outer.top && centerY <= outer.bottom;
}

export function visuallyEquivalentRects(leftRect?: RectLike, rightRect?: RectLike, iouThreshold = 0.85) {
  if (!leftRect || !rightRect)
    return false;
  return rectIoU(leftRect, rightRect) >= iouThreshold;
}

function numberOr(...values: Array<number | undefined>) {
  return values.find(value => typeof value === 'number' && Number.isFinite(value)) ?? 0;
}
