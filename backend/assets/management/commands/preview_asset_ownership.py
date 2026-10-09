"""Read-only ownership review for the server operator boundary."""
import json

from django.core.management.base import BaseCommand

from assets.models import Asset


class Command(BaseCommand):
    help = "预览资产部门归属及使用人部门候选；只读，不自动回填或改变授权。"

    def add_arguments(self, parser):
        parser.add_argument("--only-unowned", action="store_true", help="仅列出尚未确认归属的资产（包括归档资产）")

    def handle(self, *args, **options):
        queryset = Asset.all_objects.select_related(
            "owning_department", "assigned_person__department", "rack_allocation__rack__room",
        ).order_by("pk")
        if options["only_unowned"]:
            queryset = queryset.filter(owning_department__isnull=True)
        count = 0
        for asset in queryset.iterator(chunk_size=500):
            allocation = getattr(asset, "rack_allocation", None)
            assignee = asset.assigned_person
            row = {
                "asset_id": asset.pk, "asset_no": asset.asset_no,
                "archived": asset.archived_at is not None,
                "data_center_id": allocation.rack.room.data_center_id if allocation else asset.asset_data_center_id,
                "owning_department_id": asset.owning_department_id,
                "owning_department": asset.owning_department.name if asset.owning_department_id else "",
                "assignee_department_candidate_id": assignee.department_id if assignee else None,
                "assignee_department_candidate": assignee.department.name if assignee and assignee.department_id else "",
                "status": "unconfirmed" if asset.owning_department_id is None else "confirmed",
            }
            self.stdout.write(json.dumps(row, ensure_ascii=False))
            count += 1
        self.stdout.write(json.dumps({"summary": {"records": count, "read_only": True, "auto_assigned": 0}}, ensure_ascii=False))
