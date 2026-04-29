/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { defaultAiIntentSettings, normalizeAiIntentSettings, normalizeProfiles } from './settings';
import type { AiIntentSettings, AiProviderProfile, AiUsageRecord } from './types';

const settingsKey = 'ai-intent-settings';
const profilesKey = 'ai-intent-provider-profiles';
const usageRecordsKey = 'ai-intent-usage-records';
const maxUsageRecords = 1000;

chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

export async function loadAiIntentSettings(): Promise<AiIntentSettings> {
  const stored = await chrome.storage.local.get(settingsKey);
  return normalizeAiIntentSettings(stored[settingsKey]);
}

export async function saveAiIntentSettings(settings: AiIntentSettings) {
  await chrome.storage.local.set({ [settingsKey]: normalizeAiIntentSettings(settings) });
}

export async function loadAiProviderProfiles(): Promise<AiProviderProfile[]> {
  const stored = await chrome.storage.local.get(profilesKey);
  return normalizeProfiles(stored[profilesKey]);
}

export async function saveAiProviderProfiles(profiles: AiProviderProfile[]) {
  await chrome.storage.local.set({ [profilesKey]: normalizeProfiles(profiles) });
}

export async function loadAiApiKey(profile: AiProviderProfile): Promise<string> {
  const stored = await chrome.storage.local.get(profile.apiKeyStorageKey);
  return String(stored[profile.apiKeyStorageKey] || '');
}

export async function saveAiApiKey(profile: AiProviderProfile, apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await chrome.storage.local.remove(profile.apiKeyStorageKey);
    return;
  }
  await chrome.storage.local.set({ [profile.apiKeyStorageKey]: trimmed });
}

export async function loadAiUsageRecords(): Promise<AiUsageRecord[]> {
  const stored = await chrome.storage.local.get(usageRecordsKey);
  return Array.isArray(stored[usageRecordsKey]) ? stored[usageRecordsKey] : [];
}

export async function appendAiUsageRecords(records: AiUsageRecord[]) {
  if (!records.length)
    return;
  const existing = await loadAiUsageRecords();
  await chrome.storage.local.set({ [usageRecordsKey]: [...existing, ...records].slice(-maxUsageRecords) });
}

export async function clearAiUsageRecords() {
  await chrome.storage.local.set({ [usageRecordsKey]: [] });
}

export function apiKeyPreview(apiKey: string) {
  if (!apiKey)
    return undefined;
  if (apiKey.length <= 8)
    return '********';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function withApiKeyPreview(profile: AiProviderProfile, apiKey: string): AiProviderProfile {
  return {
    ...profile,
    apiKeyPreview: apiKeyPreview(apiKey),
  };
}

export { defaultAiIntentSettings };
