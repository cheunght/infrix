from django.core.management.base import BaseCommand, CommandError

from assets.backups import BackupServiceError, restore_backup


class Command(BaseCommand):
    help = "Restore an Infrix MariaDB backup after an explicit confirmation."

    def add_arguments(self, parser):
        parser.add_argument("backup_id_or_filename")
        parser.add_argument(
            "--confirm-restore",
            required=True,
            help='Must be exactly "RESTORE INFRIX".',
        )

    def handle(self, *args, **options):
        try:
            result = restore_backup(
                options["backup_id_or_filename"],
                confirmation=options["confirm_restore"],
            )
        except BackupServiceError as exc:
            raise CommandError(exc.message) from exc
        self.stdout.write(
            self.style.SUCCESS(
                "Backup restored: "
                f"{result['filename']} "
                f"(database={result['database_status']}, media={result['media_status']})"
            )
        )
