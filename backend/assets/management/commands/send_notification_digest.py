from django.core.management.base import BaseCommand, CommandError
from assets.background_jobs import submit
from assets.maintenance_gate import business_access, MaintenanceUnavailable
from assets.runtime_clock import system_now


class Command(BaseCommand):
    help = "Queue today's explicitly enabled daily digest; work_jobs performs delivery."

    def handle(self, *args, **options):
        try:
            with business_access():
                job = submit('notification_digest', {}, user=None, key=f'daily-digest:{system_now().date()}')
        except MaintenanceUnavailable:
            raise CommandError('Maintenance active; digest not queued.') from None
        self.stdout.write(f'queued: job={job.id}, status={job.status}')
