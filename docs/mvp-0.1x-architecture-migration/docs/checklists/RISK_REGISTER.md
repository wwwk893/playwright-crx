# Risk Register

## P0 risks

1. Generated replay passes without business state success.
   - Mitigation: terminal-state assertions in every generated replay E2E.

2. Stop/export loses final action or input value.
   - Mitigation: Session Finalizer + InputTransaction commit.

3. Parser-safe runtime playback diverges from exported code.
   - Mitigation: UiActionRecipe + dual renderer + action count tests.

4. CrxPlayer global fallback clicks wrong element.
   - Mitigation: narrow runtime bridge only; fail closed on ambiguity.

## P1 risks

1. Select option context mismatches after portal/search/virtual list.
   - Mitigation: SelectTransaction, dropdownContextId, exact tokens.

2. Table row action clicks wrong row.
   - Mitigation: table row recipe with tableId + rowIdentity.

3. User edits overwritten by projection.
   - Mitigation: projection preserves editable fields.

4. Legacy flows fail import.
   - Mitigation: flowMigration tests.

## P2 risks

1. Too many docs/indirection slow development.
   - Mitigation: PR façades preserve old APIs.

2. More tests increase runtime.
   - Mitigation: split L1/L2/L3 and use targeted smoke.

3. Diagnostic data privacy.
   - Mitigation: redact before storage and export strip.
