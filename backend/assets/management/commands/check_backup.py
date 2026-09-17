from django.core.management.base import BaseCommand, CommandError

from assets.backups import BackupServiceError, backup_preflight


class Command(BaseCommand):
    help = "Run read-only checks for Infrix MariaDB backup support."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", dest="as_json")

    def handle(self, *args, **options):
        try:
            result = backup_preflight()
        except BackupServiceError as exc:
            raise CommandError(exc.message) from exc
        required = (
            result["database_engine"] == "mariadb"
            and result["database_configured"]
            and result["dump_client_available"]
            and result["restore_client_available"]
            and result["backup_directory_writable"]
            and result["backup_directory_safe"]
        )
        if options["as_json"]:
            import json

            self.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True))
            if not required:
                raise CommandError("Backup preflight failed; see the JSON checks above.")
            return
        for key, value in result.items():
            self.stdout.write(f"{key}: {value}")
        if not required:
            raise CommandError("Backup preflight failed; see the checks above.")
