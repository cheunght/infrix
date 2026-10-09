"""Freeze authorization evidence when audits are written; project it on reads.

Historical labels cannot be authorized using today's directory or placement.
Incomplete legacy evidence keeps the event, but hides its business details.
"""
from collections.abc import Mapping


def capture_scope(resource_type, resource_id, extra):
    from .models import Asset, Attachment, FaultEvent, InventoryItem, RepairRecord, RepairPartUsage
    related = {
        'attachment': (Attachment, 'asset_id'),
        'fault_event': (FaultEvent, 'asset_id'),
        'repair_record': (RepairRecord, 'fault__asset_id'),
        'inventory_item': (InventoryItem, 'asset_id'),
        'repair_part_usage': (RepairPartUsage, 'fault__asset_id'),
    }
    if resource_type not in related and resource_type != 'spare_stock_transaction':
        return None
    asset_id = extra.get('asset_id')
    record = None
    if resource_type in related and str(resource_id).isdigit():
        model, path = related[resource_type]
        record = model.objects.filter(pk=resource_id)
        asset_id = asset_id or record.values_list(path, flat=True).first()
    if not asset_id:
        return None
    asset = Asset.all_objects.filter(pk=asset_id).values(
        'owning_department_id', 'asset_data_center_id',
        'rack_allocation__rack__room__data_center_id').first()
    if not asset:
        return None
    evidence = {'version': 1, 'asset_id': asset_id,
        'department_id': asset['owning_department_id'],
        'center_id': asset['rack_allocation__rack__room__data_center_id'] or asset['asset_data_center_id']}
    if resource_type == 'inventory_item' and record is not None:
        evidence['inventory_task_id'] = record.values_list('task_id', flat=True).first()
    if resource_type == 'repair_part_usage' and record is not None:
        usage = record.values('source', 'spare_stock__data_center_id').first()
        if usage is None or usage['source'] == RepairPartUsage.INTERNAL_STOCK:
            evidence['stock_center_id'] = usage['spare_stock__data_center_id'] if usage else None
            # Missing/deleted stock is not evidence of an unlocated source.
            evidence['stock_source_known'] = evidence['stock_center_id'] is not None
    return evidence


def _asset_snapshot_visible(snapshot, scope):
    allocation = snapshot.get('rack_allocation')
    if allocation:
        if not isinstance(allocation, Mapping) or 'data_center_id' not in allocation:
            return False
        center = allocation['data_center_id']
    else:
        if 'asset_data_center' not in snapshot:
            return False
        center = snapshot['asset_data_center']
    if 'owning_department' not in snapshot:
        return scope.full_department_access(center_id=center)
    return scope.contains_asset(center, snapshot['owning_department'])


def details_visible(log, scope, visible_task_ids):
    if scope.global_read:
        return True
    payload = log.payload if isinstance(log.payload, Mapping) else {}
    snapshots = [payload[key] for key in ('before', 'after') if isinstance(payload.get(key), Mapping) and payload[key]]
    extra = payload.get('extra') if isinstance(payload.get('extra'), Mapping) else {}
    if not snapshots:
        return False
    if log.resource_type == 'asset':
        if not all(_asset_snapshot_visible(snapshot, scope) for snapshot in snapshots):
            return False
    else:
        evidence = extra.get('timeline_scope')
        if not isinstance(evidence, Mapping) or evidence.get('version') != 1:
            return False
        if not {'asset_id', 'center_id', 'department_id'} <= evidence.keys():
            return False
        if not scope.contains_asset(evidence['center_id'], evidence['department_id']):
            return False
        if 'stock_center_id' in evidence and (
            not evidence.get('stock_source_known') or not scope.contains(evidence['stock_center_id'])):
            return False
        if log.resource_type == 'spare_stock_transaction':
            for snapshot in snapshots:
                if not {'source_data_center', 'target_data_center'} <= snapshot.keys():
                    return False
                if any(snapshot[key] is not None and not scope.contains(snapshot[key])
                       for key in ('source_data_center', 'target_data_center')):
                    return False
        if log.resource_type == 'inventory_item':
            task_id = evidence.get('inventory_task_id')
            if not isinstance(task_id, int) or task_id not in visible_task_ids:
                return False
            for snapshot in snapshots:
                if snapshot.get('actual_placement') in {'mounted', 'data_center', 'unlocated'}:
                    observation = snapshot.get('actual_location_snapshot')
                    if not isinstance(observation, Mapping) or 'data_center_id' not in observation:
                        return False
                    if 'owning_department_id' in observation:
                        if not scope.contains_asset(observation['data_center_id'], observation['owning_department_id']):
                            return False
                    elif not scope.full_department_access(center_id=observation['data_center_id']):
                        return False
    task_id = extra.get('inventory_task_id')
    if task_id and (not isinstance(task_id, int) or task_id not in visible_task_ids):
        return False
    if extra.get('source') == 'inventory_resolution' and not task_id:
        return False
    return True
