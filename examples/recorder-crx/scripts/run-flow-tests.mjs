/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const tempDir = await mkdtemp(path.join(tmpdir(), 'recorder-flow-tests-'));
const outfile = path.join(tempDir, 'stepStability.test.mjs');

try {
  await build({
    entryPoints: [path.join(projectRoot, 'src/flow/stepStability.test.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
