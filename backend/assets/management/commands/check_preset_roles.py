from django.core.management.base import BaseCommand, CommandError

from assets.bootstrap import initialize_system_data
from assets.roles import ROLE_DEFINITIONS


class Command(BaseCommand):
    help = "检查并补齐 Infrix 四个预设业务角色"

    def handle(self, *args, **options):
        try:
            groups = initialize_system_data()
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        missing = set(ROLE_DEFINITIONS) - set(groups)
        if missing:
            raise CommandError(f"预设角色初始化失败：{', '.join(sorted(missing))}")
        self.stdout.write(self.style.SUCCESS("预设角色检查通过：4/4"))
