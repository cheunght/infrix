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

## Ownership and assignment

**Asset owning department**:
The department accountable for an asset. Ownership is independent of the asset's current assignee and physical location; assignment, transfer of use, or relocation does not change ownership.

**Unowned asset**:
An asset whose owning department has not been confirmed. This is separate from an unlocated asset, which has no physical placement.

**Person department**:
The department to which a person belongs. It determines access to that person's directory record; it does not determine ownership of assets used by the person.

## Asset lifecycle

**Archived asset**:
An asset removed from the current operating ledger while retaining its identity, archival snapshot, attachments, and business history. Archival preserves the business status; restoring the archive returns the same asset to the current ledger. Assigned, mounted, or operationally unresolved assets must finish their active responsibilities before archival.

**Asset disposal**:
The business fact recorded when a dedicated disposal action causes an asset to enter the retired state; it includes the event date, reason, method, operator snapshot, and optional notes.

**Legacy retired asset**:
An asset already stored as retired before disposal records were introduced. It may have no disposal fact and must be shown as historical, not as an uncompleted disposal.

## Data authorization

**Function capability**:
Permission to perform a kind of operation. It does not grant access to every record on which the operation could run.

**Data scope**:
The explicit boundary within which an account may read or write. Asset access must satisfy both the physical-location boundary and the owning-department boundary; unlocated and unowned assets require separate explicit grants. Person directory access follows the person's department. A scope consists of a base rule and optional additional rules: each asset must satisfy location and ownership in the same complete rule, and complete rules are unioned. Write access includes reading the complete write pair; read and write facets are not recombined. Facility and person selectors can use center and department unions independently, without widening asset access. Selected departments do not imply their descendants. Missing grants deny business data access.

**Global data authorization**:
An explicit authorization to operate across all data centers, departments, and assets awaiting placement or ownership confirmation; the system administrator role carries this authorization. Staff status and other business roles do not imply it.

**Fully visible inventory task**:
An inventory task whose task center, every asset's current location and ownership, frozen original location and ownership, and recorded observation are within the account's authorized scope. Each new observation freezes the owning department at recording time. Missing legacy ownership evidence requires complete department access at its frozen center and is not inferred from the current asset. A partial task is not exposed as a complete task.

**Shared reference data**:
Company-wide catalogs used to identify and select business entities. Person directory records remain subject to department authorization. Access to shared reference data does not grant access to related assets, stock balances, or global business metrics.

**Admitted read snapshot**:
A consistent database view opened after account authorization admission and held through response preparation. It prevents concurrent facility moves from combining an old location with newly visible related records. Streamed file delivery retains the account admission lock after the database snapshot closes.
