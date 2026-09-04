from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from assets.lifecycle import transition_asset_status
from assets.models import Asset, DataCenter, DeviceType, Manufacturer, Rack, ServerRoom
from assets.services import update_asset_placement


DEMO_CENTERS = (
    ("演示·华北数据中心", "北京市朝阳区·演示园区", "HB"),
    ("演示·华东数据中心", "上海市浦东新区·演示园区", "EC"),
    ("演示·华南数据中心", "广东省深圳市南山区·演示园区", "SC"),
)

DEVICE_TYPES = (
    ("服务器", "#1677EF", "联想 ThinkSystem SR650"),
    ("交换机", "#65A30D", "华为 CloudEngine S5735"),
    ("存储", "#8B5CF6", "戴尔 PowerStore 1200T"),
    ("网络设备", "#0891B2", "深信服 AF-1000"),
    ("其他", "#64748B", "APC PDU 9000"),
)

# The sum of each pattern is the occupied U count. A one-U gap is inserted
# after every third device to keep the visual data useful for boundary checks.
UNIT_PATTERNS = {
    32: (3, 2, 1, 4, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1),
    33: (3, 2, 1, 4, 2, 3, 1, 3, 2, 4, 1, 2, 3, 2),
    34: (4, 2, 1, 3, 2, 4, 1, 3, 2, 1, 4, 2, 3, 2),
    36: (4, 3, 1, 2, 4, 2, 1, 3, 4, 2, 1, 3, 2, 4),
}


def placements_for_occupancy(total_u: int, occupied_u: int) -> list[tuple[int, int]]:
    units_pattern = UNIT_PATTERNS[occupied_u]
    cursor = total_u
    placements: list[tuple[int, int]] = []
    for index, units in enumerate(units_pattern):
        end_u = cursor
        start_u = end_u - units + 1
        if start_u < 1:
            raise ValueError(f"{occupied_u}U demo pattern does not fit in a {total_u}U rack")
        placements.append((start_u, end_u))
        cursor = start_u - 1
        if index < len(units_pattern) - 1 and (index + 1) % 3 == 0:
            cursor -= 1
    return placements


class Command(BaseCommand):
    help = "Create idempotent local demo data for Rack U-position visualization."

    @transaction.atomic
    def handle(self, *args, **options):
        device_types = {}
        for name, color, model in DEVICE_TYPES:
            device_type, _ = DeviceType.objects.get_or_create(
                name=name,
                defaults={"color": color, "is_active": True},
            )
            device_types[name] = (device_type, model)

        manufacturers = {}
        for name, code in (
            ("演示设备制造商", "DEMO-VENDOR"),
            ("演示网络设备厂商", "DEMO-NETWORK"),
        ):
            manufacturer, _ = Manufacturer.objects.get_or_create(
                name=name,
                defaults={"code": code, "is_active": True},
            )
            manufacturers[name] = manufacturer

        rack_count = 0
        asset_count = 0
        allocation_count = 0

        for center_name, address, center_code in DEMO_CENTERS:
            data_center, _ = DataCenter.objects.get_or_create(
                name=center_name,
                defaults={"address": address, "is_active": True},
            )
            if not data_center.is_active or data_center.address != address:
                data_center.is_active = True
                data_center.address = address
                data_center.save(update_fields=["is_active", "address", "updated_at"])

            room, _ = ServerRoom.objects.get_or_create(
                data_center=data_center,
                name="核心机房·演示区",
                defaults={
                    "is_active": True,
                    "owner_name": "IT 基础设施组",
                    "notes": "本地 Rack Front View 演示数据",
                },
            )
            if not room.is_active:
                room.is_active = True
                room.save(update_fields=["is_active", "updated_at"])

            for rack_index, occupied_u in enumerate((32, 34, 36, 33), start=1):
                rack_code = f"{center_code}-R{rack_index:02d}"
                rack, _ = Rack.objects.get_or_create(
                    room=room,
                    code=rack_code,
                    defaults={
                        "name": f"{center_name} {rack_code}",
                        "rack_type": "标准 45U 机柜",
                        "total_u": 45,
                        "is_active": True,
                        "status": "in_use",
                        "notes": "本地可视化演示机柜",
                    },
                )
                highest_u = rack.allocations.order_by("-end_u").values_list("end_u", flat=True).first() or 0
                if highest_u > 45:
                    raise CommandError(
                        f"演示机柜 {rack.code} 已有资产占用到 U{highest_u}，不能缩小到 45U"
                    )
                rack.name = f"{center_name} {rack_code}"
                rack.rack_type = "标准 45U 机柜"
                rack.total_u = 45
                rack.is_active = True
                rack.status = "in_use"
                rack.notes = "本地可视化演示机柜"
                rack.save()
                rack_count += 1

                placements = placements_for_occupancy(rack.total_u, occupied_u)
                for asset_index, (start_u, end_u) in enumerate(placements, start=1):
                    device_name = ("服务器", "交换机", "存储", "网络设备", "其他")[
                        (asset_index + rack_index - 2) % 5
                    ]
                    device_type, model = device_types[device_name]
                    asset_no = f"DEMO-{center_code}-R{rack_index:02d}-{asset_index:02d}"
                    asset, created = Asset.objects.get_or_create(
                        asset_no=asset_no,
                        defaults={
                            "name": f"{device_name} {center_code}-R{rack_index:02d}-{asset_index:02d}",
                            "manufacturer_model": model,
                            "serial_number": f"DEMO-SN-{center_code}-{rack_index:02d}-{asset_index:02d}",
                            "purpose": "Rack U 位可视化演示资产",
                            "manufacturer": manufacturers["演示设备制造商"],
                            "device_type": device_type,
                        },
                    )
                    if created:
                        transition_asset_status(asset, "in_use")
                    asset.name = f"{device_name} {center_code}-R{rack_index:02d}-{asset_index:02d}"
                    asset.manufacturer_model = model
                    asset.manufacturer = manufacturers[
                        "演示网络设备厂商" if device_name in {"交换机", "网络设备"} else "演示设备制造商"
                    ]
                    asset.device_type = device_type
                    asset.purpose = "Rack U 位可视化演示资产"
                    asset.save()
                    asset_count += 1

                    update_asset_placement(
                        asset,
                        rack=rack,
                        start_u=start_u,
                        end_u=end_u,
                    )
                    allocation_count += 1

                utilization = round(occupied_u / rack.total_u * 100)
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{data_center.name} / {rack.code}: {occupied_u}/{rack.total_u}U ({utilization}%), "
                        f"{len(placements)} assets"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo rack seed complete: {len(DEMO_CENTERS)} data centers, "
                f"{rack_count} racks, {asset_count} assets, {allocation_count} allocations."
            )
        )
