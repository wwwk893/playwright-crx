/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React from 'react';
import type { FlowStep } from '../flow/types';

export const AiIntentBadge: React.FC<{
  step: FlowStep;
  pending?: boolean;
}> = ({ step, pending }) => {
  if (pending)
    return <span className='intent-source-badge ai pending'>AI 生成中</span>;
  if (step.intentSource === 'user')
    return <span className='intent-source-badge user'>人工修改</span>;
  if (step.intentSource === 'ai')
    return <span className='intent-source-badge ai'>{badgeText('AI', step)}</span>;
  if (step.intentSource === 'rule')
    return <span className='intent-source-badge rule'>{badgeText('规则', step)}</span>;
  if (step.intentSuggestion)
    return <span className='intent-source-badge rule'>{badgeText('建议', step)}</span>;
  return null;
};

function badgeText(prefix: string, step: FlowStep) {
  const confidence = step.intentSuggestion?.confidence;
  const model = step.intentSuggestion?.source === 'ai' && step.intentSuggestion.model ? ` · ${step.intentSuggestion.model}` : '';
  return `${prefix}${typeof confidence === 'number' ? ` ${Math.round(confidence * 100)}%` : ''}${model}`;
}
