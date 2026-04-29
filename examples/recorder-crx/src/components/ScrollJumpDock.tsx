/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import React from 'react';

export const ScrollJumpDock: React.FC = () => {
  const dockRef = React.useRef<HTMLDivElement | null>(null);

  const jump = React.useCallback((direction: 'top' | 'bottom') => {
    const scrollTarget = scrollContainerFor(dockRef.current);
    const top = direction === 'top' ? 0 : scrollTarget.scrollHeight;
    scrollTarget.scrollTo({ top, behavior: 'smooth' });
  }, []);

  return <div className='scroll-jump-dock' ref={dockRef} aria-label='步骤滚动导航'>
    <button type='button' data-tooltip='回到顶部' aria-label='回到顶部' onClick={() => jump('top')}>
      <svg viewBox='0 0 20 20' aria-hidden='true'>
        <path d='M5.5 12.5 10 8l4.5 4.5' />
      </svg>
    </button>
    <span className='scroll-jump-divider'></span>
    <button type='button' data-tooltip='跳到底部' aria-label='跳到底部' onClick={() => jump('bottom')}>
      <svg viewBox='0 0 20 20' aria-hidden='true'>
        <path d='M5.5 7.5 10 12l4.5-4.5' />
      </svg>
    </button>
  </div>;
};

function scrollContainerFor(element: HTMLElement | null): HTMLElement {
  let node = element?.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
      return node;
    node = node.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
}
