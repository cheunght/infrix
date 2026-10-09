# Infrix Asset Operations

This context names the physical placement and inventory concepts used to manage assets across data centers, server rooms, and racks.

## Physical placement

**Physical placement**:
An asset's recorded physical location, from a direct data-center assignment to a mounted rack position with a U range.

**Direct data-center assignment**:
A physical placement that identifies the asset's data center without assigning it to a rack or U range.
_Avoid_: unmounted location

**Unlocated asset**:
An asset with neither a rack/U position nor a direct data-center assignment.
_Avoid_: no-location asset

**Mounted asset**:
An asset with a rack and a complete start/end U range recorded as its rack position.
_Avoid_: racked device

**Unrack**:
Remove an asset's rack and U position while retaining its direct data-center assignment.
_Avoid_: clear location

**Clear placement**:
Remove an asset's rack/U position and its direct data-center assignment.
_Avoid_: unrack

**Rack occupancy**:
The U range claimed by a mounted asset within a rack; overlapping ranges are invalid.

**Placement transition**:
A physical placement may move atomically between mounted, direct data-center assignment, and unlocated states; mounting determines the direct data center, unracking retains it, and clearing removes both rack occupancy and direct assignment.

## Inventory

**Observed inventory placement**:
The physical location recorded when an operator checks an inventory item. Its location names and U range describe that observation, even if the facility is later renamed or moved. A normal result confirms the task's original placement snapshot.
An observation can identify a mounted position, a direct data-center assignment, or an explicit unlocated state. An unconfirmed observation cannot clear placement; correction to an unlocated state requires that state to have been recorded explicitly.

**Inventory correction**:
The physical-placement change recorded when an inventory result identifies a location mismatch and an operator updates the asset record.
_Avoid_: inventory fix

## Asset lifecycle

**Archived asset**:
An asset removed from the current operating ledger while retaining its identity, archival snapshot, attachments, and business history. Archival preserves the business status; restoring the archive returns the same asset to the current ledger. Assigned, mounted, or operationally unresolved assets must finish their active responsibilities before archival.

**Asset disposal**:
The business fact recorded when a dedicated disposal action causes an asset to enter the retired state; it includes the event date, reason, method, operator snapshot, and optional notes.

**Legacy retired asset**:
An asset already stored as retired before disposal records were introduced. It may have no disposal fact and must be shown as historical, not as an uncompleted disposal.
