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
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React from 'react';

export const FlowSelectionGuard: React.FC<{
  onBackToLibrary: () => void;
  onNewFlow: () => void;
}> = ({ onBackToLibrary, onNewFlow }) => {
  return <section className='flow-selection-guard' aria-label='流程选择守卫' aria-live='polite'>
    <div className='flow-selection-guard-icon'>!</div>
    <div className='flow-selection-guard-copy'>
      <span>录制上下文缺失</span>
      <h2>先选择或新建一个流程</h2>
      <p>录制必须绑定到具体流程，不会开始全局录制。</p>
      <p>请从流程库打开已有记录，或创建一个带名称的流程后再开始录制。</p>
    </div>
    <div className='flow-selection-guard-actions'>
      <button type='button' onClick={onBackToLibrary}>返回流程库</button>
      <button type='button' className='primary' onClick={onNewFlow}>新建流程</button>
    </div>
  </section>;
};
