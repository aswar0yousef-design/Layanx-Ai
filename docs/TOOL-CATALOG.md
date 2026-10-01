# Tool Catalog and Discovery

LayanX now provides a constrained capability catalog for dynamic agent tool selection.

- Tool definitions can declare explicit `actions` and `tags`.
- `ToolCatalog` exposes only safe metadata.
- `ToolSelector` ranks candidates deterministically using names, descriptions, actions, and tags.
- Agent allowlists, forbidden resources, and permission ceilings are applied before ranking.
- Discovery never exposes adapters, credentials, or execution internals.
- Actual execution still passes through the existing ExecutionRuntime security pipeline.

This layer is intentionally read-only: discovering a tool never executes it.
