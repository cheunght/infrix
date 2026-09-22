from django.core.management.base import BaseCommand, CommandError

from assets.bootstrap import initialize_system_data
from assets.organization_access import inspect_role_assignments, role_codes


class Command(BaseCommand):
    help = "检查并补齐 Infrix 四个预设业务角色"

    def handle(self, *args, **options):
        try:
            groups = initialize_system_data()
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        missing = set(role_codes()) - set(groups)
        if missing:
            raise CommandError(f"预设角色初始化失败：{', '.join(sorted(missing))}")
        report = inspect_role_assignments()
        if report["multiple_role_user_ids"]:
            self.stdout.write(self.style.WARNING(
                "检测到多角色账号："
                + ", ".join(str(value) for value in report["multiple_role_user_ids"])
            ))
        if report["unknown_group_names"]:
            self.stdout.write(self.style.WARNING(
                "检测到未识别的 Group：" + ", ".join(report["unknown_group_names"])
            ))
        self.stdout.write(self.style.SUCCESS("预设角色检查通过：4/4"))
