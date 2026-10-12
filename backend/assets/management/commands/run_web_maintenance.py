from django.core.management.base import BaseCommand
from assets.web_maintenance import execute_operation


class Command(BaseCommand):
    help = "Execute one reserved web backup/restore outside the HTTP worker."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("operation_id")
        parser.add_argument("--lock-fd", required=True, type=int)

    def handle(self, *args, **options):
        execute_operation(options["operation_id"], options["lock_fd"])
