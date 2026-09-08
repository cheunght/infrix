from django.core.management.base import BaseCommand, CommandError
from assets.notification_delivery import send_digest


class Command(BaseCommand):
    help = "Send the explicitly enabled daily operational email digest."

    def handle(self, *args, **options):
        try:
            result = send_digest()
        except Exception:
            raise CommandError("Digest unavailable; check database and application configuration.") from None
        self.stdout.write(f"{result['status']}: sent={result['sent']}, failed={result['failed']}")
        if result["failed"]:
            raise CommandError("Digest delivery requires attention. See system maintenance.")
