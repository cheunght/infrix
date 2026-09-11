"""Location scope resolution for dashboard reports."""

from dataclasses import dataclass

from django.db.models import Q

from ..models import Asset, DataCenter, Rack, ServerRoom


class DashboardScopeError(ValueError):
    """Raised when a dashboard location filter is invalid."""


@dataclass
class DashboardScope:
    selected_data_center: DataCenter | None
    selected_server_room: ServerRoom | None
    asset_queryset: object
    asset_rows: list
    racks: list
    rooms: list
    active_data_centers: list

    @property
    def asset_ids(self):
        return [asset.id for asset in self.asset_rows]


def _parse_id(value, label):
    if not value:
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise DashboardScopeError(f"{label}筛选无效") from exc


def resolve_dashboard_scope(request):
    """Resolve filters and load the dashboard's scoped infrastructure data.

    The active-resource predicates intentionally live here so every report
    section uses the same definition of a usable data center, room and rack.
    """
    data_center_id = _parse_id(
        request.query_params.get("data_center", "").strip(), "数据中心"
    )
    server_room_value = (
        request.query_params.get("server_room", "").strip()
        or request.query_params.get("room", "").strip()
    )
    server_room_id = _parse_id(server_room_value, "机房")

    selected_data_center = None
    if data_center_id is not None:
        selected_data_center = DataCenter.objects.filter(
            pk=data_center_id, is_active=True
        ).first()
        if selected_data_center is None:
            raise DashboardScopeError("数据中心筛选无效")

    selected_server_room = None
    if server_room_id is not None:
        selected_server_room = (
            ServerRoom.objects.select_related("data_center")
            .filter(
                pk=server_room_id,
                is_active=True,
                data_center__is_active=True,
            )
            .first()
        )
        if selected_server_room is None:
            raise DashboardScopeError("机房筛选无效")
        if (
            selected_data_center is not None
            and selected_server_room.data_center_id != selected_data_center.id
        ):
            raise DashboardScopeError("所选机房不属于当前数据中心")
        if selected_data_center is None:
            selected_data_center = selected_server_room.data_center

    asset_queryset = Asset.objects.all()
    if selected_server_room is not None:
        asset_queryset = asset_queryset.filter(
            rack_allocation__rack__room_id=selected_server_room.id,
            rack_allocation__rack__is_active=True,
            rack_allocation__rack__room__is_active=True,
            rack_allocation__rack__room__data_center__is_active=True,
        )
    elif selected_data_center is not None:
        asset_queryset = asset_queryset.filter(
            Q(
                rack_allocation__rack__room__data_center_id=selected_data_center.id,
                rack_allocation__rack__is_active=True,
                rack_allocation__rack__room__is_active=True,
                rack_allocation__rack__room__data_center__is_active=True,
            )
            | Q(
                rack_allocation__isnull=True,
                asset_data_center_id=selected_data_center.id,
            )
        )
    asset_queryset = asset_queryset.distinct()
    asset_rows = list(
        asset_queryset.select_related(
            "asset_model__device_type",
            "standalone_device_type",
            "asset_data_center",
            "rack_allocation__rack__room__data_center",
        ).prefetch_related("network_addresses")
    )

    rack_queryset = Rack.objects.filter(
        is_active=True,
        room__is_active=True,
        room__data_center__is_active=True,
    )
    if selected_data_center is not None:
        rack_queryset = rack_queryset.filter(
            room__data_center_id=selected_data_center.id
        )
    if selected_server_room is not None:
        rack_queryset = rack_queryset.filter(room_id=selected_server_room.id)
    racks = list(
        rack_queryset.select_related("room__data_center")
        .prefetch_related("allocations")
        .order_by("room__data_center__name", "room__name", "code")
    )

    room_queryset = ServerRoom.objects.filter(
        is_active=True,
        data_center__is_active=True,
    )
    if selected_data_center is not None:
        room_queryset = room_queryset.filter(data_center_id=selected_data_center.id)
    if selected_server_room is not None:
        room_queryset = room_queryset.filter(pk=selected_server_room.id)
    rooms = list(
        room_queryset.select_related("data_center").order_by(
            "data_center__name", "name"
        )
    )

    active_data_center_queryset = DataCenter.objects.filter(is_active=True).order_by(
        "name"
    )
    if selected_data_center is not None:
        active_data_center_queryset = active_data_center_queryset.filter(
            pk=selected_data_center.id
        )

    return DashboardScope(
        selected_data_center=selected_data_center,
        selected_server_room=selected_server_room,
        asset_queryset=asset_queryset,
        asset_rows=asset_rows,
        racks=racks,
        rooms=rooms,
        active_data_centers=list(active_data_center_queryset),
    )
