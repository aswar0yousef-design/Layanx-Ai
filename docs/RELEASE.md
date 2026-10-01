# LayanX Release Gate

A production release must have evidence for typecheck, tests, red-team checks, configuration validation, and recovery readiness.

The release is also bound to a version, Git commit SHA, and SHA-256 manifest checksum.

Flow:

Development -> Staging -> Release Gate -> Production

A failed gate blocks promotion. The manifest becomes the auditable release identity and can be used as the basis for Last Known Good and rollback records.
