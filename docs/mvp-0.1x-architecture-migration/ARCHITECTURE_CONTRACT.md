# ARCHITECTURE_CONTRACT.md

This migration succeeds only if every PR moves the repository closer to the target layer model.

## Contract

```text
Raw Event → Event Journal → Transaction → Business Step Projection → UiActionRecipe → Renderer → Runtime Bridge
```

## Hard checks for reviewers

For every PR, reviewers must ask:

1. Did this PR move logic into the correct layer?
2. Did this PR add new AntD/ProComponents heuristics to `flowBuilder.ts` or `codePreview.ts`? If yes, reject unless it is temporary and explicitly marked for removal.
3. Did this PR let low-level input/press events become business steps? If yes, reject.
4. Did this PR make exported Playwright and parser-safe runtime playback diverge? If yes, require a shared `UiActionRecipe` or explicit runtime bridge contract.
5. Did this PR modify `src/server/*`? If yes, require narrow runtime bridge scope and legacy player regression.

## Required end state by PR-12

- `flowBuilder.ts`: façade only.
- `codePreview.ts`: façade only.
- `crxRecorder.tsx`: UI orchestration only.
- `pageContextSidecar.ts`: capture/semantic context only; no FlowStep creation.
- `src/server/recorder/crxPlayer.ts`: runtime bridge only.
- `interactions/*`: transaction composition.
- `replay/*`: recipe-based rendering.
