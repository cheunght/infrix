from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from assets.lifecycle import transition_asset_status
from assets.models import (
    Asset,
    AssetTag,
    DataCenter,
    Department,
    DeviceType,
    Manufacturer,
    MaintenanceContract,
    Person,
    ProcurementRecord,
    Rack,
    ServerRoom,
    Tag,
)
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

DEMO_MANUFACTURERS = (
    ("演示设备制造商", "DEMO-VENDOR"),
    ("演示网络设备厂商", "DEMO-NETWORK"),
    ("Dell Technologies", "DEMO-DELL"),
    ("Cisco Systems", "DEMO-CISCO"),
    ("NetApp", "DEMO-NETAPP"),
    ("Fortinet", "DEMO-FORTINET"),
    ("APC", "DEMO-APC"),
)

DEMO_DEPARTMENTS = (
    ("演示·基础设施组", "DEMO-INFRA"),
    ("演示·网络运维组", "DEMO-NETOPS"),
    ("Demo Platform Engineering", "DEMO-PLATFORM"),
)

DEMO_PEOPLE = (
    {
        "employee_no": "DEMO-CN-001",
        "name": "张伟",
        "department_code": "DEMO-INFRA",
        "email": "zhang.wei@example.test",
        "organization": "Infrix Demo China",
        "contact": "+86 138 0000 1001",
    },
    {
        "employee_no": "DEMO-EN-001",
        "name": "Emily Carter",
        "department_code": "DEMO-PLATFORM",
        "email": "emily.carter@example.test",
        "organization": "Infrix Demo Platform",
        "contact": "+1 202 555 0101",
    },
    {
        "employee_no": "DEMO-EN-002",
        "name": "Michael Brown",
        "department_code": "DEMO-NETOPS",
        "email": "michael.brown@example.test",
        "organization": "Infrix Demo Network Operations",
        "contact": "+1 202 555 0102",
    },
)

DEMO_TAGS = (
    "演示环境",
    "Demo · English",
    "Demo · Production",
    "Demo · Network",
    "Demo · Storage",
)

# A bilingual profile is deliberately kept at the seed-data layer. It does
# not add a language field to Asset; it simply makes the list, detail, import
# and export screens useful when checking mixed-language content.
ASSET_PROFILES = {
    "服务器": {
        "zh": {
            "name": "应用服务器",
            "model": "联想 ThinkSystem SR650",
            "manufacturer": "演示设备制造商",
            "purpose": "生产业务与应用服务",
            "notes": "中文演示资产，用于验证机柜位置、保修和资产详情。",
            "supplier": "演示设备供应链",
            "maintenance_provider": "演示原厂服务中心",
            "warranty_months": 36,
            "depreciation_years": 5,
            "residual_rate": Decimal("0.05"),
            "purchase_amount": Decimal("68000.00"),
        },
        "en": {
            "name": "Production Web Server",
            "model": "Dell PowerEdge R750",
            "manufacturer": "Dell Technologies",
            "purpose": "Production application hosting",
            "notes": "English demo asset for rack placement and lifecycle details.",
            "supplier": "Demo Infrastructure Supply",
            "maintenance_provider": "Northwind Support Services",
            "warranty_months": 36,
            "depreciation_years": 5,
            "residual_rate": Decimal("0.05"),
            "purchase_amount": Decimal("72000.00"),
        },
    },
    "交换机": {
        "zh": {
            "name": "核心交换机",
            "model": "华为 CloudEngine S5735",
            "manufacturer": "演示网络设备厂商",
            "purpose": "数据中心核心网络接入",
            "notes": "中文演示网络设备，包含链路和机柜位置信息。",
            "supplier": "演示网络设备供应链",
            "maintenance_provider": "演示网络服务中心",
            "warranty_months": 24,
            "depreciation_years": 4,
            "residual_rate": Decimal("0.08"),
            "purchase_amount": Decimal("18500.00"),
        },
        "en": {
            "name": "Core Network Switch",
            "model": "Cisco Catalyst 9300",
            "manufacturer": "Cisco Systems",
            "purpose": "Data center core network access",
            "notes": "English demo network asset with rack and support metadata.",
            "supplier": "Demo Network Supply",
            "maintenance_provider": "Northwind Network Care",
            "warranty_months": 24,
            "depreciation_years": 4,
            "residual_rate": Decimal("0.08"),
            "purchase_amount": Decimal("21000.00"),
        },
    },
    "存储": {
        "zh": {
            "name": "业务存储阵列",
            "model": "戴尔 PowerStore 1200T",
            "manufacturer": "演示设备制造商",
            "purpose": "数据库与虚拟化存储",
            "notes": "中文演示存储资产，用于验证较长说明文本的展示。",
            "supplier": "演示存储设备供应链",
            "maintenance_provider": "演示存储服务中心",
            "warranty_months": 36,
            "depreciation_years": 5,
            "residual_rate": Decimal("0.05"),
            "purchase_amount": Decimal("96000.00"),
        },
        "en": {
            "name": "Virtualization Storage Array",
            "model": "NetApp AFF A250",
            "manufacturer": "NetApp",
            "purpose": "Database and virtualization storage",
            "notes": "English demo storage asset with extended metadata for testing.",
            "supplier": "Demo Storage Supply",
            "maintenance_provider": "Northwind Storage Services",
            "warranty_months": 36,
            "depreciation_years": 5,
            "residual_rate": Decimal("0.05"),
            "purchase_amount": Decimal("105000.00"),
        },
    },
    "网络设备": {
        "zh": {
            "name": "安全网关",
            "model": "深信服 AF-1000",
            "manufacturer": "演示网络设备厂商",
            "purpose": "边界安全与流量审计",
            "notes": "中文演示安全设备，包含维修和维保信息。",
            "supplier": "演示安全设备供应链",
            "maintenance_provider": "演示安全服务中心",
            "warranty_months": 24,
            "depreciation_years": 4,
            "residual_rate": Decimal("0.10"),
            "purchase_amount": Decimal("32000.00"),
        },
        "en": {
            "name": "Edge Security Gateway",
            "model": "FortiGate 200F",
            "manufacturer": "Fortinet",
            "purpose": "Perimeter security and traffic inspection",
            "notes": "English demo security asset for maintenance and warranty views.",
            "supplier": "Demo Security Supply",
            "maintenance_provider": "Northwind Security Services",
            "warranty_months": 24,
            "depreciation_years": 4,
            "residual_rate": Decimal("0.10"),
            "purchase_amount": Decimal("35000.00"),
        },
    },
    "其他": {
        "zh": {
            "name": "机柜配电单元",
            "model": "APC PDU 9000",
            "manufacturer": "演示设备制造商",
            "purpose": "机柜电源分配",
            "notes": "中文演示配电设备。",
            "supplier": "演示机房设备供应链",
            "maintenance_provider": "演示机房服务中心",
            "warranty_months": 12,
            "depreciation_years": 3,
            "residual_rate": Decimal("0.10"),
            "purchase_amount": Decimal("8500.00"),
        },
        "en": {
            "name": "Rack Power Distribution Unit",
            "model": "APC NetShelter PDU 9000",
            "manufacturer": "APC",
            "purpose": "Rack power distribution",
            "notes": "English demo power asset for compact table and export checks.",
            "supplier": "Demo Data Center Supply",
            "maintenance_provider": "Northwind Data Center Services",
            "warranty_months": 12,
            "depreciation_years": 3,
            "residual_rate": Decimal("0.10"),
            "purchase_amount": Decimal("9000.00"),
        },
    },
}

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
        for name, code in DEMO_MANUFACTURERS:
            manufacturer, _ = Manufacturer.objects.get_or_create(
                name=name,
                defaults={"code": code, "is_active": True},
            )
            if not manufacturer.is_active:
                manufacturer.is_active = True
                manufacturer.save(update_fields=["is_active", "updated_at"])
            manufacturers[name] = manufacturer

        departments = {}
        for name, code in DEMO_DEPARTMENTS:
            department, _ = Department.objects.get_or_create(
                code=code,
                defaults={"name": name},
            )
            if department.name != name:
                department.name = name
                department.save(update_fields=["name", "updated_at"])
            departments[code] = department

        people = {}
        for person_data in DEMO_PEOPLE:
            values = {
                "name": person_data["name"],
                "department": departments[person_data["department_code"]],
                "email": person_data["email"],
                "organization": person_data["organization"],
                "contact": person_data["contact"],
                "is_active": True,
            }
            person, _ = Person.objects.get_or_create(
                employee_no=person_data["employee_no"],
                defaults=values,
            )
            changed_fields = []
            for field, value in values.items():
                if getattr(person, field) != value:
                    setattr(person, field, value)
                    changed_fields.append(field)
            if changed_fields:
                person.save(update_fields=[*changed_fields, "updated_at"])
            people[person.employee_no] = person

        tags = {}
        for name in DEMO_TAGS:
            tag, _ = Tag.objects.get_or_create(
                name=name,
                defaults={"is_active": True},
            )
            if not tag.is_active:
                tag.is_active = True
                tag.save(update_fields=["is_active", "updated_at"])
            tags[name] = tag
        demo_people = tuple(people.values())

        rack_count = 0
        asset_count = 0
        english_asset_count = 0
        assigned_asset_count = 0
        procurement_count = 0
        maintenance_count = 0
        allocation_count = 0

        for center_index, (center_name, address, center_code) in enumerate(DEMO_CENTERS, start=1):
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
                    device_type, default_model = device_types[device_name]
                    is_english = (center_index + rack_index + asset_index) % 6 == 0
                    language = "en" if is_english else "zh"
                    profile = ASSET_PROFILES[device_name][language]
                    if is_english:
                        english_asset_count += 1
                    asset_no = f"DEMO-{center_code}-R{rack_index:02d}-{asset_index:02d}"
                    asset_name = f"{profile['name']} {center_code}-R{rack_index:02d}-{asset_index:02d}"
                    purchase_date = date(
                        2023 + ((center_index + rack_index + asset_index) % 3),
                        1 + ((rack_index + asset_index) % 12),
                        1 + ((center_index + asset_index) % 24),
                    )
                    assigned_person = None
                    if (center_index * 10 + rack_index + asset_index) % 9 == 0:
                        assigned_person = demo_people[(center_index + rack_index + asset_index) % len(demo_people)]
                        assigned_asset_count += 1
                    asset_notes = (
                        f"{profile['notes']} Rack {rack_code}, U{start_u}-{end_u}."
                    )
                    asset, created = Asset.objects.get_or_create(
                        asset_no=asset_no,
                        defaults={
                            "name": asset_name,
                            "model_text": profile["model"] or default_model,
                            "serial_number": f"DEMO-SN-{center_code}-{rack_index:02d}-{asset_index:02d}",
                            "purpose": profile["purpose"],
                            "standalone_manufacturer": manufacturers[profile["manufacturer"]],
                            "standalone_device_type": device_type,
                            "warranty_months": profile["warranty_months"],
                            "assigned_person": assigned_person,
                            "notes": asset_notes,
                            "depreciation_start_date": purchase_date,
                            "depreciation_years": profile["depreciation_years"],
                            "residual_rate": profile["residual_rate"],
                            "depreciation_method": "straight_line",
                        },
                    )
                    if created:
                        transition_asset_status(asset, "in_use")
                    asset.name = asset_name
                    asset.asset_model = None
                    asset.model_text = profile["model"] or default_model
                    asset.standalone_manufacturer = manufacturers[profile["manufacturer"]]
                    asset.standalone_device_type = device_type
                    asset.warranty_months = profile["warranty_months"]
                    asset.assigned_person = assigned_person
                    asset.purpose = profile["purpose"]
                    asset.notes = asset_notes
                    asset.depreciation_start_date = purchase_date
                    asset.depreciation_years = profile["depreciation_years"]
                    asset.residual_rate = profile["residual_rate"]
                    asset.depreciation_method = "straight_line"
                    asset.save()
                    asset_count += 1

                    procurement, _ = ProcurementRecord.objects.get_or_create(
                        asset=asset,
                        defaults={
                            "purchase_date": purchase_date,
                            "supplier": profile["supplier"],
                            "order_no": f"DEMO-PO-{center_code}-{rack_index:02d}-{asset_index:02d}",
                            "amount": profile["purchase_amount"] + Decimal(asset_index * 250),
                            "notes": "English demo procurement record."
                            if is_english
                            else "中文演示采购记录。",
                        },
                    )
                    procurement.purchase_date = purchase_date
                    procurement.supplier = profile["supplier"]
                    procurement.order_no = f"DEMO-PO-{center_code}-{rack_index:02d}-{asset_index:02d}"
                    procurement.amount = profile["purchase_amount"] + Decimal(asset_index * 250)
                    procurement.notes = "English demo procurement record." if is_english else "中文演示采购记录。"
                    procurement.save()
                    procurement_count += 1

                    if (center_index + rack_index + asset_index) % 3 == 0:
                        maintenance, _ = MaintenanceContract.objects.get_or_create(
                            asset=asset,
                            defaults={
                                "provider": profile["maintenance_provider"],
                                "contract_no": f"DEMO-MC-{center_code}-{rack_index:02d}-{asset_index:02d}",
                                "start_date": purchase_date,
                                "expiry_date": date(
                                    purchase_date.year + max(1, profile["warranty_months"] // 12),
                                    purchase_date.month,
                                    purchase_date.day,
                                ),
                                "notes": "English demo maintenance contract."
                                if is_english
                                else "中文演示维保合同。",
                            },
                        )
                        maintenance.provider = profile["maintenance_provider"]
                        maintenance.contract_no = f"DEMO-MC-{center_code}-{rack_index:02d}-{asset_index:02d}"
                        maintenance.start_date = purchase_date
                        maintenance.expiry_date = date(
                            purchase_date.year + max(1, profile["warranty_months"] // 12),
                            purchase_date.month,
                            purchase_date.day,
                        )
                        maintenance.notes = "English demo maintenance contract." if is_english else "中文演示维保合同。"
                        maintenance.save()
                        maintenance_count += 1

                    tag_names = {
                        "Demo · English" if is_english else "演示环境",
                        "Demo · Network"
                        if device_name in {"交换机", "网络设备"}
                        else "Demo · Storage"
                        if device_name == "存储"
                        else "Demo · Production",
                    }
                    for tag_name in tag_names:
                        AssetTag.objects.get_or_create(asset=asset, tag=tags[tag_name])

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
                f"{rack_count} racks, {asset_count} assets ({english_asset_count} English), "
                f"{assigned_asset_count} assigned, {procurement_count} procurement records, "
                f"{maintenance_count} maintenance contracts, {allocation_count} allocations."
            )
        )
