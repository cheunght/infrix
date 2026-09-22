from django.core.management.base import BaseCommand, CommandError

from assets.system_maintenance import MaintenanceError, create_backup


class Command(BaseCommand):
    help = "Create a complete local MariaDB backup for Infrix."

    def handle(self, *args, **options):
        try:
            result = create_backup()
        except MaintenanceError as exc:
            raise CommandError(exc.message) from exc
        self.stdout.write(f"Backup created: {result['filename']}")
