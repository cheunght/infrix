import time
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from assets.background_jobs import run_one
from assets.maintenance_gate import MaintenanceUnavailable


class Command(BaseCommand):
    help = 'Execute durable jobs on this host; restart safely after interruption.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Execute at most one available job and exit.')
        parser.add_argument('--poll-seconds', type=float, default=2)

    def handle(self, *args, **options):
        if not 0.1 <= options['poll_seconds'] <= 60:
            raise CommandError('poll-seconds must be between 0.1 and 60.')
        while True:
            close_old_connections()
            try:
                worked = run_one()
            except MaintenanceUnavailable:
                if options['once']:
                    raise CommandError('Maintenance active; no job executed.') from None
                worked = False
            if options['once']:
                return
            if not worked:
                time.sleep(options['poll_seconds'])
