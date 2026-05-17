/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type { UiActionRecipe } from './types';
import { stringLiteral } from './stepEmitterUtils';

export type AntDRecipeRendererCapability =
  | 'antd-owned-option-dispatch'
  | 'antd-tree-option-dispatch'
  | 'antd-cascader-path-dispatch'
  | 'field-trigger-search-option'
  | 'active-popup-option'
  | 'field-locator-fill'
  | 'table-row-action'
  | 'table-row-scoped-action'
  | 'popover-confirm'
  | 'dialog-scoped-action';

export function isRecipeBackedAntdSelectOption(recipe: UiActionRecipe | undefined) {
  return !!recipe &&
    recipe.operation === 'selectOption' &&
    recipe.component === 'Select' &&
    (recipe.framework === 'antd' || recipe.framework === 'procomponents') &&
    recipe.replay?.runtimeFallback === 'active-antd-popup-option' &&
    !!(recipe.option?.displayText || recipe.option?.text || recipe.optionText);
}

export function recipeOptionText(recipe: UiActionRecipe | undefined) {
  return recipe?.option?.displayText || recipe?.option?.text || recipe?.optionText;
}

export function recipeOptionSearchText(recipe: UiActionRecipe | undefined) {
  return recipe?.option?.searchText;
}

export function renderAntdSelectOptionClickSource(triggerLocator: string, optionLocator: string, optionName?: string, searchText?: string) {
  if (optionName)
    return antdOwnedSelectOptionClickSource(triggerLocator, optionName, searchText);
  return [
    `// AntD Select virtual dropdown replay workaround: locator.click() may hit search input or portal/modal overlays.`,
    `if (!await ${optionLocator}.first().isVisible().catch(() => false))`,
    `  await ${triggerLocator}.click();`,
    antdSelectOptionDispatchSource(optionLocator, optionName, { clickFirstMatch: true }),
    `await page.locator(".ant-select-dropdown:visible").first().waitFor({ state: "hidden", timeout: 1000 }).catch(() => {});`,
  ].filter(Boolean).join('\n');
}

export function renderAntdPopupOptionClickSource(locator: string, optionName?: string, triggerLocator?: string, options: { stabilizeAfterClickMs?: number; clickFirstMatch?: boolean } = {}) {
  const opener = triggerLocator ? [
    `if (!await ${locator}.first().isVisible().catch(() => false))`,
    `  await ${triggerLocator}.click();`,
  ].join('\n') : undefined;
  return [
    opener,
    antdPopupOptionDispatchSource(locator, optionName, options),
  ].filter(Boolean).join('\n');
}

function antdOwnedSelectOptionClickSource(triggerLocator: string, optionName: string, searchText?: string) {
  return [
    `// AntD Select virtual dropdown replay workaround: dispatch the target option owned by this trigger, not a stale global dropdown.`,
    `await (async () => {`,
    `  const trigger = ${triggerLocator};`,
    `  const expectedText = ${stringLiteral(optionName)};`,
    searchText ? `  const searchText = ${stringLiteral(searchText)};` : undefined,
    `  const inputSelector = ${stringLiteral('input[aria-controls], input[aria-owns], input[role="combobox"], input')};`,
    `  const selectOwnedOption = async (dispatch) => {`,
    `    const result = await trigger.locator(inputSelector).first().evaluate(async (input, payload) => {`,
    `      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `      const expected = normalize(payload.expectedText);`,
    `      const isElementVisible = (element) => {`,
    `        const style = window.getComputedStyle(element);`,
    `        const rect = element.getBoundingClientRect();`,
    `        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;`,
    `      };`,
    `      const isDropdownVisible = (dropdown) => dropdown && !dropdown.classList.contains("ant-select-dropdown-hidden") && isElementVisible(dropdown);`,
    `      const triggerRoot = input.closest(".ant-select") || input.closest(".ant-select-selector") || input.parentElement;`,
    `      const triggerRect = triggerRoot?.getBoundingClientRect();`,
    `      const distanceToTrigger = (dropdown) => {`,
    `        if (!triggerRect)`,
    `          return Number.MAX_SAFE_INTEGER;`,
    `        const rect = dropdown.getBoundingClientRect();`,
    `        const dx = Math.abs((rect.left + rect.width / 2) - (triggerRect.left + triggerRect.width / 2));`,
    `        const dy = Math.abs(rect.top - triggerRect.bottom);`,
    `        return dx + dy;`,
    `      };`,
    `      const ownedRoots = () => {`,
    `        const activeDescendant = input.getAttribute("aria-activedescendant");`,
    `        const activeListId = activeDescendant ? activeDescendant.replace(/_\\d+$/, "") : "";`,
    `        const listIds = [input.getAttribute("aria-controls"), input.getAttribute("aria-owns"), activeListId].filter(Boolean);`,
    `        const roots = [];`,
    `        for (const listId of listIds) {`,
    `          const list = document.getElementById(listId);`,
    `          const dropdown = list?.closest(".ant-select-dropdown");`,
    `          if (dropdown && !roots.includes(dropdown))`,
    `            roots.push(dropdown);`,
    `          else if (list && !roots.includes(list))`,
    `            roots.push(list);`,
    `        }`,
    `        if (roots.length)`,
    `          return roots;`,
    `        return Array.from(document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden)"))`,
    `            .filter(isDropdownVisible)`,
    `            .sort((a, b) => distanceToTrigger(a) - distanceToTrigger(b))`,
    `            .slice(0, 1);`,
    `      };`,
    `      const findVisibleOwnedOption = () => {`,
    `        const options = ownedRoots().flatMap(root => Array.from(root.querySelectorAll(".ant-select-item-option")));`,
    `        const optionMatches = options.map(element => {`,
    `          const dropdown = element.closest(".ant-select-dropdown");`,
    `          if (!isDropdownVisible(dropdown) || !isElementVisible(element))`,
    `            return undefined;`,
    `          const content = normalize(element.querySelector(".ant-select-item-option-content")?.textContent);`,
    `          const text = normalize(element.textContent);`,
    `          const title = normalize(element.getAttribute("title"));`,
    `          return { element, exact: title === expected || content === expected || text === expected, partial: content.includes(expected) || text.includes(expected) };`,
    `        }).filter(Boolean);`,
    `        return optionMatches.find(match => match.exact)?.element || optionMatches.find(match => match.partial)?.element;`,
    `      };`,
    `      let element = findVisibleOwnedOption();`,
    `      const deadline = Date.now() + (payload.dispatch ? 10000 : 0);`,
    `      while (!element && payload.dispatch && Date.now() < deadline) {`,
    `        await new Promise(resolve => setTimeout(resolve, 50));`,
    `        element = findVisibleOwnedOption();`,
    `      }`,
    `      if (!element) {`,
    `        if (!payload.dispatch)`,
    `          return false;`,
    `        throw new Error(\`AntD option not found in trigger-owned dropdown: \${expected}\`);`,
    `      }`,
    `      if (!payload.dispatch)`,
    `        return true;`,
    `      if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled"))`,
    `        throw new Error(\`AntD option is disabled: \${expected}\`);`,
    `      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));`,
    `      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `      return true;`,
    `    }, { expectedText, dispatch }, { timeout: dispatch ? 10000 : 1000 }).catch(error => {`,
    `      if (dispatch)`,
    `        throw error;`,
    `      return false;`,
    `    });`,
    `    return !!result;`,
    `  };`,
    `  if (!await selectOwnedOption(false)) {`,
    `    await trigger.click();`,
    searchText ? `    await trigger.locator(inputSelector).first().fill(searchText);` : undefined,
    `  }`,
    `  await selectOwnedOption(true);`,
    `  await trigger.locator(${stringLiteral('input[aria-expanded="false"]')}).first().waitFor({ state: "attached", timeout: 1000 }).catch(() => {});`,
    `})();`,
    `await expect(${triggerLocator}).toContainText(${stringLiteral(optionName)}, { timeout: 10000 });`,
  ].filter(Boolean).join('\n');
}

export function antdPopupOptionDispatchSource(locator: string, optionName?: string, options: { stabilizeAfterClickMs?: number; clickFirstMatch?: boolean } = {}) {
  const source = antdSelectOptionDispatchSource(locator, optionName, { includeHoverEvents: true, clickFirstMatch: options.clickFirstMatch });
  return options.stabilizeAfterClickMs ? `${source}\nawait page.waitForTimeout(${options.stabilizeAfterClickMs});` : source;
}

export function antdSelectOptionDispatchSource(locator: string, optionName?: string, options: { includeHoverEvents?: boolean; clickFirstMatch?: boolean } = {}) {
  const hoverLines = options.includeHoverEvents ? [
    `  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));`,
  ] : [];
  if (!optionName) {
    return [
      `await ${locator}.last().evaluate(element => {`,
      ...hoverLines,
      `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
      `});`,
    ].join('\n');
  }
  if (options.clickFirstMatch) {
    return [
      `await ${locator}.first().waitFor({ state: "visible", timeout: 10000 });`,
      `await ${locator}.first().evaluate((element, expectedText) => {`,
      `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
      `  const expected = normalize(expectedText);`,
      `  const text = normalize(element.textContent);`,
      `  const title = normalize(element.getAttribute("title"));`,
      `  if (!text.includes(expected) && title !== expected)`,
      `    throw new Error(\`AntD option text mismatch: expected \${expected}, got \${text}\`);`,
      `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled"))`,
      `    throw new Error(\`AntD option is disabled: \${expected}\`);`,
      ...hoverLines,
      `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
      `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
      `}, ${stringLiteral(optionName)});`,
    ].join('\n');
  }
  return [
    `await ${locator}.first().waitFor({ state: "visible", timeout: 10000 });`,
    `await ${locator}.evaluateAll((elements, expectedText) => {`,
    `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `  const expected = normalize(expectedText);`,
    `  const expectedTokens = expected.split(" ").filter(Boolean).filter(token => !/^(共享|独享|shared|dedicated)$/i.test(token));`,
    `  const matchesExpected = (value) => {`,
    `    const normalized = normalize(value);`,
    `    return normalized === expected || expectedTokens.every(token => normalized.includes(token)) || (!!expectedTokens[0] && normalized.includes(expectedTokens[0]));`,
    `  };`,
    `  const exactElement = elements.find(element => {`,
    `    const optionText = normalize(element.querySelector(".ant-select-item-option-content")?.textContent);`,
    `    const title = normalize(element.getAttribute("title"));`,
    `    const text = normalize(element.textContent);`,
    `    return title === expected || optionText === expected || text === expected;`,
    `  });`,
    `  const fallbackElement = elements.find(element => {`,
    `    const optionText = normalize(element.querySelector(".ant-select-item-option-content")?.textContent);`,
    `    return matchesExpected(element.getAttribute("title")) || matchesExpected(optionText) || matchesExpected(element.textContent);`,
    `  });`,
    `  const element = exactElement || fallbackElement;`,
    `  if (!element)`,
    `    throw new Error(\`AntD option not found: \${expected}\`);`,
    `  const text = normalize(element.textContent);`,
    `  if (!matchesExpected(text) && !matchesExpected(element.getAttribute("title")))`,
    `    throw new Error(\`AntD option text mismatch: expected \${expected}, got \${text}\`);`,
    `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled"))`,
    `    throw new Error(\`AntD option is disabled: \${expected}\`);`,
    ...hoverLines,
    `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `}, ${stringLiteral(optionName)});`,
  ].join('\n');
}

export function activePopupOptionDispatchSource(locator: string, expectedExpression: string) {
  const optionLocator = `${locator}.filter({ hasText: ${expectedExpression} })`;
  return [
    `await ${optionLocator}.first().waitFor({ state: "visible", timeout: 10000 });`,
    `await ${optionLocator}.first().evaluate((element, expectedText) => {`,
    `  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();`,
    `  const expected = normalize(expectedText);`,
    `  const text = normalize(element.textContent);`,
    `  const title = normalize(element.getAttribute("title"));`,
    `  if (!text.includes(expected) && title !== expected)`,
    `    throw new Error(\`AntD popup option text mismatch: expected \${expected}, got \${text}\`);`,
    `  if (element.getAttribute("aria-disabled") === "true" || element.classList.contains("ant-select-item-option-disabled") || element.classList.contains("ant-cascader-menu-item-disabled"))`,
    `    throw new Error(\`AntD popup option is disabled: \${expected}\`);`,
    `  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));`,
    `  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));`,
    `}, ${expectedExpression});`,
  ].join('\n');
}
