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
import { del, get, keys, set } from 'idb-keyval';
import type { BusinessFlow } from './types';

const draftPrefix = 'business-flow-draft:';
const latestDraftKey = 'business-flow-draft:latest';
const recordPrefix = 'business-flow-record:';

export async function saveFlowDraft(flow: BusinessFlow): Promise<void> {
  await Promise.all([
    set(draftKey(flow.flow.id), flow),
    set(latestDraftKey, flow.flow.id),
  ]);
}

export async function loadFlowDraft(flowId: string): Promise<BusinessFlow | undefined> {
  return await get<BusinessFlow>(draftKey(flowId));
}

export async function loadLatestFlowDraft(): Promise<BusinessFlow | undefined> {
  const flowId = await get<string>(latestDraftKey);
  return flowId ? await loadFlowDraft(flowId) : undefined;
}

export async function listFlowDrafts(): Promise<BusinessFlow[]> {
  const draftKeys = (await keys()).filter(key => typeof key === 'string' && key.startsWith(draftPrefix) && key !== latestDraftKey) as string[];
  const drafts = await Promise.all(draftKeys.map(key => get<BusinessFlow>(key)));
  return drafts
      .filter((draft): draft is BusinessFlow => !!draft)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteFlowDraft(flowId: string): Promise<void> {
  const latestFlowId = await get<string>(latestDraftKey);
  await del(draftKey(flowId));
  if (latestFlowId === flowId)
    await del(latestDraftKey);
}

export async function saveFlowRecord(flow: BusinessFlow): Promise<void> {
  const savedFlow = {
    ...flow,
    updatedAt: new Date().toISOString(),
  };
  await set(recordKey(savedFlow.flow.id), savedFlow);
}

export async function loadFlowRecord(flowId: string): Promise<BusinessFlow | undefined> {
  return await get<BusinessFlow>(recordKey(flowId));
}

export async function listFlowRecords(): Promise<BusinessFlow[]> {
  const recordKeys = (await keys()).filter(key => typeof key === 'string' && key.startsWith(recordPrefix)) as string[];
  const records = await Promise.all(recordKeys.map(key => get<BusinessFlow>(key)));
  return records
      .filter((record): record is BusinessFlow => !!record)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteFlowRecord(flowId: string): Promise<void> {
  await del(recordKey(flowId));
}

function draftKey(flowId: string) {
  return `${draftPrefix}${flowId}`;
}

function recordKey(flowId: string) {
  return `${recordPrefix}${flowId}`;
}
