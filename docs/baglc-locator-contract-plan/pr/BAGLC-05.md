# BAGLC-05 OverlayPrediction Shadow Mode

## Scope

用 MutationObserver 观察 AntD portal overlay，先不改变 FlowStep。

## Files

Create:

- `capture/overlayPrediction.ts`

Modify:

- `pageContextSidecar.ts`
- `flow/eventJournal.ts`
- `flow/sessionFinalizer.ts`
- `flow/pageContextTypes.ts`

## Done when

- click select trigger -> resolved select-dropdown。
- click modal opener -> resolved modal。
- click delete -> resolved popconfirm。
- no overlay -> expired。
- multiple overlays -> ambiguous。

## Validation

```bash
npm run test:flow --prefix examples/recorder-crx
npm run build:examples:recorder
```
