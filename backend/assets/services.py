"""Compatibility exports; domain modules own business writes."""
from .asset_configuration import CustomFieldConflictError, configure_asset, apply_asset_custom_values, apply_asset_tags
from .asset_writes import assign_asset, return_asset, transfer_asset, dispose_asset, _locked_person
# Existing imports remain supported; repair lifecycle writes have one owner.
from .repair_writes import (REPAIR_RESTORE_STATUSES, sync_asset_fault_status, sync_fault_completion, sync_repair_completion, reopen_repair)

# Existing server callers retain their import path; inventory writes live here.
from .stock import apply_spare_stock_transaction, create_repair_part_usage

# Counting rules and writes are owned by the inventory domain.
from .inventory_writes import (InventoryObservationConflict, reset_inventory_resolution, inventory_snapshot_location, confirm_inventory_item_normal, inventory_task_delete_block_reason, inventory_task_can_delete, validate_inventory_resolution_request, resolve_inventory_item)
