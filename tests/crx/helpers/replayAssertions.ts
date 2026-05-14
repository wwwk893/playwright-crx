/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, type TestInfo } from '@playwright/test';
import type { BrowserContext, Page } from 'playwright-core';
import { createReplayFailureDiagnosticsArtifact } from '../../../examples/recorder-crx/src/flow/replayDiagnostics';
import type { BusinessFlow } from '../../../examples/recorder-crx/src/flow/types';
import type { ReplayFailureDiagnosticSource } from '../../../examples/recorder-crx/src/flow/adaptiveFailureReport';

export type GeneratedReplayVerification = {
  verify: (page: Page) => Promise<void>;
  standalone: string[];
  diagnostics?: {
    flow?: BusinessFlow;
    stepIds?: string[];
    source?: ReplayFailureDiagnosticSource;
  };
};

export async function replayGeneratedPlaywrightCode(
  context: BrowserContext,
  code: string,
  testInfo: TestInfo,
  verification: GeneratedReplayVerification,
) {
  assertReplayVerification(verification);

  const rawReplayDir = testInfo.outputPath('raw-generated-replay');
  fs.mkdirSync(rawReplayDir, { recursive: true });
  fs.writeFileSync(path.join(rawReplayDir, 'generated-before-inline.spec.ts'), code);

  const body = testBody(code);
  const replayPage = await context.newPage();
  try {
    const replay = new Function('page', 'expect', `return (async () => {\n${body}\n})();`);
    await replay(replayPage, expect);
    await verification.verify(replayPage);
  } catch (error) {
    writeReplayFailureDiagnostics(path.join(rawReplayDir, 'replay-failure-diagnostics.json'), code, errorMessage(error), verification.diagnostics);
    if (verification.diagnostics?.flow) {
      try {
        runGeneratedPlaywrightSourceAsStandaloneSpec(code, testInfo, verification.standalone, verification.diagnostics);
      } catch {
        // Keep the inline failure as the primary E2E signal; the standalone run has written its raw output artifact.
      }
    }
    throw error;
  } finally {
    await replayPage.close();
  }
  runGeneratedPlaywrightSourceAsStandaloneSpec(code, testInfo, verification.standalone, verification.diagnostics);
}

export function appendReplayVerification(code: string, verificationLines: string[]) {
  if (!verificationLines.length)
    return code;
  const bodyEnd = code.lastIndexOf('\n});');
  if (bodyEnd < 0)
    throw new Error(`Unable to append generated replay verification:\n${code}`);
  return `${code.slice(0, bodyEnd)}\n\n  // business terminal-state verification added by the E2E harness\n  ${verificationLines.join('\n  ')}\n${code.slice(bodyEnd)}`;
}

function assertReplayVerification(verification: GeneratedReplayVerification) {
  if (!verification?.verify)
    throw new Error('Generated replay E2E must provide inline terminal-state verification.');
  if (!verification.standalone?.length)
    throw new Error('Generated replay E2E must provide standalone terminal-state verification lines.');
}

function runGeneratedPlaywrightSourceAsStandaloneSpec(
  code: string,
  testInfo: TestInfo,
  verificationLines: string[],
  diagnostics?: GeneratedReplayVerification['diagnostics'],
) {
  const rawReplayRoot = path.join(__dirname, '..', '..', '.raw-generated-replay');
  const repoRoot = path.join(__dirname, '..', '..', '..');
  fs.mkdirSync(rawReplayRoot, { recursive: true });
  const rawReplayDir = fs.mkdtempSync(path.join(rawReplayRoot, `${testInfo.workerIndex}-`));
  const specPath = path.join(rawReplayDir, 'generated-replay.spec.ts');
  const configPath = path.join(rawReplayDir, 'playwright.raw-replay.config.ts');
  const outputPath = path.join(rawReplayDir, 'raw-replay-output.txt');
  const specSource = appendReplayVerification(code, verificationLines);
  fs.writeFileSync(specPath, specSource);
  fs.writeFileSync(configPath, [
    `import { defineConfig, devices } from '@playwright/test';`,
    `export default defineConfig({`,
    `  testDir: ${JSON.stringify(rawReplayDir)},`,
    `  outputDir: ${JSON.stringify(path.join(rawReplayDir, 'test-results'))},`,
    `  timeout: 120000,`,
    `  workers: 1,`,
    `  retries: 0,`,
    `  preserveOutput: 'always',`,
    `  reporter: [['line']],`,
    `  use: { ...devices['Desktop Chrome'], baseURL: ${JSON.stringify(rawReplayBaseURL())}, trace: 'off', screenshot: 'off', video: 'off' },`,
    `});`,
    ``,
  ].join('\n'));
  const result = spawnSync('npx', ['playwright', 'test', specPath, '--config', configPath], {
    cwd: repoRoot,
    env: { ...process.env, CI: '0' },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.stack || result.error.message}` : ''}`;
  fs.writeFileSync(outputPath, output);
  if (result.status !== 0 || result.error) {
    writeReplayFailureDiagnostics(path.join(rawReplayDir, 'replay-failure-diagnostics.json'), specSource, output, diagnostics);
    throw new Error(`Generated Playwright source failed as a standalone spec (exit ${result.status}). See ${outputPath}\n${output}`);
  }
}

function writeReplayFailureDiagnostics(
  outputPath: string,
  generatedSource: string,
  message: string,
  diagnostics?: GeneratedReplayVerification['diagnostics'],
) {
  if (!diagnostics?.flow)
    return;
  const artifact = createReplayFailureDiagnosticsArtifact(diagnostics.flow, { message }, {
    source: diagnostics.source || 'generated-playwright',
    stepIds: diagnostics.stepIds,
    generatedSource,
    output: message,
  });
  if (!artifact)
    return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

function errorMessage(error: unknown) {
  if (error instanceof Error)
    return `${error.message}\n${error.stack || ''}`;
  return String(error);
}

function rawReplayBaseURL() {
  return process.env.PLAYWRIGHT_CRX_TEST_BASE_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_CRX_TEST_PORT || '3107'}`;
}

function testBody(code: string) {
  const header = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{/);
  if (!header)
    throw new Error(`Unable to find generated Playwright test header:\n${code}`);
  const bodyStart = (header.index ?? 0) + header[0].length;
  let bodyEnd = code.lastIndexOf('\n});');
  if (bodyEnd < bodyStart)
    bodyEnd = code.lastIndexOf('});');
  if (bodyEnd < bodyStart)
    throw new Error(`Unable to extract generated Playwright test body:\n${code}`);
  return code.slice(bodyStart, bodyEnd)
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n');
}
