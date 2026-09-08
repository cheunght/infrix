#!/usr/bin/env python3
"""Isolated regression checks; never contacts a live database or service."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / 'deploy/install.sh'


class InstallerRegression(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='infrix-installer-check-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.config = self.directory / 'infrix.env'
        template = (ROOT / 'deploy/infrix.env.example').read_text()
        template = template.replace('DB_PASSWORD=change-me', 'DB_PASSWORD=test-fixture-only-123456789')
        template += '\nDJANGO_SECRET_KEY=' + 'a' * 64 + '\n'
        self.config.write_text(template)
        self.environment = dict(os.environ, SOURCE_DIR=str(ROOT), ENV_FILE=str(self.config),
            APP_DIR=str(self.directory / 'app'), SYSTEMD_UNIT_FILE=str(self.directory / 'infrix.service'),
            NGINX_CONF_FILE=str(self.directory / 'nginx.conf'), INSTALL_MODE='auto', PYTHON_BIN=sys.executable)
        self.state = Path(str(self.config) + '.install-state')

    def phase(self, value):
        payload = f'{hashlib.sha256(self.config.read_bytes()).hexdigest()}  {self.config}\n{self.environment["APP_DIR"]}\n'
        self.state.write_text(value + '\t' + hashlib.sha256(payload.encode()).hexdigest() + '\n')

    def run_preflight(self):
        before = self.config.read_bytes()
        result = subprocess.run(['bash', str(INSTALLER), '--preflight'], env=self.environment,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(self.config.read_bytes(), before, 'preflight mutated configuration')
        return result

    def test_config_only_is_fresh(self):
        result = self.run_preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('全新安装', result.stdout)

    def test_completed_install_is_upgrade(self):
        Path(self.environment['SYSTEMD_UNIT_FILE']).touch()
        self.phase('complete')
        result = self.run_preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('原地升级', result.stdout)

    def test_interrupted_phases_are_resumed(self):
        Path(self.environment['SYSTEMD_UNIT_FILE']).touch()
        for phase in ('configured', 'database-ready'):
            with self.subTest(phase=phase):
                self.phase(phase)
                result = self.run_preflight()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('继续未完成安装：' + phase, result.stdout)

    def test_changed_config_blocks_resume(self):
        self.phase('database-ready')
        with self.config.open('a') as stream:
            stream.write('\nDB_NAME=different_database\n')
        result = self.run_preflight()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('配置已变化', result.stderr)

    def test_changed_destination_blocks_resume(self):
        self.phase('database-ready')
        self.environment['APP_DIR'] = str(self.directory / 'different-app')
        result = self.run_preflight()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('配置已变化', result.stderr)

    def test_nginx_validation_restores_old_file(self):
        source = INSTALLER.read_text()
        block = source[source.index('chmod 644 "$NGINX_CONF_FILE"'):source.index('\nrunuser -u nginx -- test')]
        current = self.directory / 'nginx.conf'
        backup = self.directory / 'backup.conf'
        current.write_text('invalid new config\n')
        backup.write_text('original site config\n')
        environment = dict(os.environ, NGINX_CONF_FILE=str(current), nginx_previous_config=str(backup),
                           BACKUP_DIR=str(self.directory / 'backups'))
        result = subprocess.run(['bash', '-c', 'fail() { exit 1; }; log() { :; }; nginx() { return 1; };\n' + block],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(current.read_text(), backup.read_text())

    def test_explicit_failure_restarts_unmodified_service(self):
        source = INSTALLER.read_text()
        fail_function = source[source.index('fail() {'):source.index('\non_error()')]
        result = subprocess.run(['bash', '-c', 'systemctl() { printf "RECOVERY:%s %s\\n" "$1" "$2"; };\n'
                                 + fail_function + '\nupgrade_service_was_active=1; upgrade_mutation_started=0; fail test'],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('RECOVERY:start infrix', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
