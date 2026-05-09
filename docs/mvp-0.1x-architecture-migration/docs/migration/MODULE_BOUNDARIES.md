# Module Boundaries

## capture/

Collect facts only.

## flow/

Stores model, event journal, migration, projection, sanitizer.

## interactions/

Builds transactions from events.

## uiSemantics/

Recognizes UI framework and business hints.

## replay/

Builds recipes and renders code.

## components/

React UI only. Should not implement merge or codegen logic.

## src/server/

Upstream core / runtime bridge only. No business semantics.
