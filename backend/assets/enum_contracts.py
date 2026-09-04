"""Business enum contracts derived from the model choices.

The model choices remain the source of legal values.  This module exposes
stable value and display maps for services, serializers, exports and reports so
those consumers do not maintain independent copies of the same contract.
"""

from .models import Asset, InventoryItem, InventoryTask, Rack, RepairPartUsage, SparePart, SpareStockTransaction


def _choice_labels(choices):
    return dict(choices)


ASSET_STATUS_LABELS = _choice_labels(Asset.STATUS)
ASSET_STATUS_VALUES = tuple(ASSET_STATUS_LABELS)
ASSET_IMPORT_STATUS_VALUES = tuple(
    status for status in ASSET_STATUS_VALUES if status != "repair"
)

INVENTORY_TASK_STATUS_LABELS = _choice_labels(InventoryTask.STATUS)
INVENTORY_TASK_STATUS_VALUES = tuple(INVENTORY_TASK_STATUS_LABELS)
INVENTORY_ITEM_STATUS_LABELS = _choice_labels(InventoryItem.STATUS)
INVENTORY_ITEM_STATUS_VALUES = tuple(INVENTORY_ITEM_STATUS_LABELS)
INVENTORY_EXCEPTION_STATUS_VALUES = tuple(
    status
    for status in INVENTORY_ITEM_STATUS_VALUES
    if status not in {"pending", "normal"}
)
INVENTORY_RESOLUTION_STATUS_LABELS = _choice_labels(InventoryItem.RESOLUTION_STATUS)
INVENTORY_RESOLUTION_STATUS_VALUES = tuple(INVENTORY_RESOLUTION_STATUS_LABELS)
INVENTORY_RESOLUTION_ACTION_LABELS = _choice_labels(InventoryItem.RESOLUTION_ACTION)
INVENTORY_RESOLUTION_ACTION_VALUES = tuple(INVENTORY_RESOLUTION_ACTION_LABELS)

RACK_STATUS_VALUES = tuple(status for status, _ in Rack.STATUS)
# Asset and Rack both use ``in_use`` as a value.  Keep the model choice labels
# untouched (changing choices would create a migration), but expose one
# canonical runtime label to API/reporting consumers.
RACK_STATUS_LABELS = {
    **_choice_labels(Rack.STATUS),
    "in_use": ASSET_STATUS_LABELS["in_use"],
}

STOCK_OPERATION_TYPE_LABELS = _choice_labels(SpareStockTransaction.OPERATION_TYPES)
STOCK_OPERATION_TYPE_VALUES = tuple(STOCK_OPERATION_TYPE_LABELS)
STOCK_SOURCE_OPERATION_TYPES = frozenset({"outbound", "scrap", "transfer"})
STOCK_TARGET_OPERATION_TYPES = frozenset({"initial", "inbound", "transfer", "adjustment"})
STOCK_INBOUND_OPERATION_TYPES = frozenset({"initial", "inbound"})
STOCK_OUTBOUND_OPERATION_TYPES = frozenset({"outbound", "scrap"})

SPARE_UNIT_LABELS = _choice_labels(SparePart.Unit.choices)
SPARE_UNIT_VALUES = tuple(SPARE_UNIT_LABELS)

REPAIR_PART_USAGE_SOURCE_LABELS = _choice_labels(RepairPartUsage.SOURCE_CHOICES)
REPAIR_PART_USAGE_SOURCE_VALUES = tuple(REPAIR_PART_USAGE_SOURCE_LABELS)
