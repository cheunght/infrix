from django.core.management.base import BaseCommand, CommandError
from assets.background_jobs import clean_jobs
from assets.maintenance_gate import MaintenanceUnavailable


class Command(BaseCommand):
    help = 'Remove old terminal jobs and orphan job files under maintenance admission.'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=30)

    def handle(self, *args, **options):
        if options['days'] < 1:
            raise CommandError('Retain at least one day.')
        try:
            rows, files = clean_jobs(options['days'])
        except MaintenanceUnavailable:
            raise CommandError('Maintenance active; cleanup not started.') from None
        self.stdout.write(f'jobs={rows}, files={files}')
