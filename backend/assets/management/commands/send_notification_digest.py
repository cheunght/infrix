from django.core.management.base import BaseCommand, CommandError
from assets.notification_delivery import send_digest
from assets.maintenance_gate import business_access, MaintenanceUnavailable


class Command(BaseCommand):
    help = "Send today's explicitly enabled daily digest directly."

    def handle(self, *args, **options):
        try:
            with business_access():
                result = send_digest()
        except MaintenanceUnavailable:
            raise CommandError('Maintenance active; digest not sent.') from None
        self.stdout.write(f"status={result['status']}, sent={result['sent']}, failed={result['failed']}")
