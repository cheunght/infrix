from django.core.management.base import BaseCommand, CommandError

from assets.bootstrap import initialize_system_data


class Command(BaseCommand):
    help = "初始化或修复 Infrix 应用级系统数据"

    def handle(self, *args, **options):
        try:
            initialize_system_data()
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS("Infrix 应用级系统数据初始化完成"))
