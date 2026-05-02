/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export function selectorFromElementTarget(value: string | undefined) {
  const text = value?.trim();
  if (!text)
    return undefined;
  if (/^(\.|#|\[)/.test(text))
    return text;
  if (/^(css=|xpath=|text=|role=|testid=|testid:)/.test(text))
    return text;
  const tagMatch = text.match(/^([a-z][\w-]*)([.#:[>].*)?$/i);
  if (!tagMatch)
    return undefined;
  const knownHtmlTags = new Set(['a', 'article', 'aside', 'button', 'div', 'form', 'h1', 'h2', 'h3', 'header', 'input', 'label', 'li', 'main', 'nav', 'option', 'section', 'select', 'span', 'table', 'tbody', 'td', 'textarea', 'th', 'thead', 'tr', 'ul']);
  if (!knownHtmlTags.has(tagMatch[1].toLowerCase()))
    return undefined;
  return tagMatch[2] ? text : undefined;
}
