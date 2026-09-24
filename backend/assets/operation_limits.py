"""Hard bounds for synchronous operations with predictable resource usage."""


# Inventory creation snapshots the asset ledger and related network addresses
# synchronously.  Five thousand assets keeps the existing workflow practical
# while bounding the largest in-memory snapshot and bulk insert.
MAX_INVENTORY_TASK_ASSETS = 5_000

# The deployment reverse proxy accepts larger requests, but this importer is a
# synchronous, read-only XLSX parser.  Ten MiB leaves headroom below that
# proxy limit without allowing oversized parser input through direct access.
MAX_ASSET_MODEL_IMPORT_BYTES = 10 * 1024 * 1024
MAX_ASSET_MODEL_IMPORT_ROWS = 5_000
