from django.core.management.base import BaseCommand, CommandError

from assets.roles import ROLE_DEFINITIONS, ensure_preset_groups


class Command(BaseCommand):
    help = "检查并补齐 Infrix 四个预设业务角色"

    def handle(self, *args, **options):
        groups = ensure_preset_groups()
        missing = set(ROLE_DEFINITIONS) - set(groups)
        if missing:
            raise CommandError(f"预设角色初始化失败：{', '.join(sorted(missing))}")
        self.stdout.write(self.style.SUCCESS("预设角色检查通过：4/4"))
