# Rocky Linux 9 Automatic Installation and Upgrade Guide

This guide explains how to install or upgrade Infrix on a Rocky Linux 9 host.
The automatic installer provisions the application runtime, the selected
database, the frontend, the systemd service, and the Nginx reverse proxy.

The automatic installation path supports Rocky Linux 9.x through
`deploy/install.sh`. Use the [manual deployment guide](MANUAL_DEPLOYMENT.md) on
other Linux distributions.

## Deployment model

The reference production path is:

```text
Client browser → HTTPS gateway → private Nginx:80 → Gunicorn:127.0.0.1:8001 → MariaDB
                                      └→ frontend/dist
```

The external HTTPS gateway terminates public TLS and passes one authoritative
`X-Forwarded-Proto` value to Nginx. Do not expose the internal Nginx listener,
Gunicorn, or MariaDB directly to untrusted clients.

The installer preserves SELinux enforcement. It configures only the required
Nginx-to-Gunicorn permission and does not disable SELinux or weaken filesystem
permissions.

## Before you begin

The target host must provide:

- Rocky Linux 9.x with root access or an account that can use `sudo`.
- Access to the Rocky Linux package repositories and Python/npm package sources.
- A complete source tree containing `backend/manage.py`,
  `backend/requirements.txt`, `frontend/package.json`, and
  `frontend/package-lock.json`.
- Python 3.10 or newer and Node.js 18 or newer, or permission for the installer
  to install them.
- TCP port 80 restricted to the trusted HTTPS gateway.

For local MariaDB mode, the installer must be allowed to manage MariaDB and
keep TCP port 3306 bound to the local host. For an external database, prepare
the database and access policy before installation.

## v0.1 migration baseline

The `v0.1.0` source tree is a clean fresh-install migration baseline. A
development database created from pre-baseline migration history must be
recreated for the v0.1 baseline; do not try to upgrade that development
database in place. This is a pre-release development-data instruction only:
production databases must be preserved, and future `v0.1.x` releases must
ship explicit incremental migrations for production upgrades.

## 1. Obtain the source

Clone the repository to a staging directory or place the supplied source
package there:

```bash
sudo -i
dnf install -y git
git clone <repository-url> /tmp/infrix-src
cd /tmp/infrix-src
```

Do not place `/etc/infrix/infrix.env` inside the source tree. Keep passwords,
keys, backups, generated dependencies, and runtime data outside the source
directory.

## 2. Configure the production environment

The following example uses `<hostname>` as the public application hostname.
Replace every placeholder with values for the deployment:

```bash
export SERVER_NAME='<hostname>'
export DJANGO_ENV=production
export DJANGO_DEBUG=0
export DJANGO_ALLOWED_HOSTS='<hostname>'
export DJANGO_CSRF_TRUSTED_ORIGINS='https://<hostname>'
export DJANGO_HTTPS_MODE=proxy
export DJANGO_SECURE_SSL_REDIRECT=1
export DJANGO_SESSION_COOKIE_SECURE=1
export DJANGO_CSRF_COOKIE_SECURE=1
export DJANGO_SECURE_HSTS_SECONDS=3600
export DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=0
export DJANGO_SECURE_HSTS_PRELOAD=0
export DJANGO_USE_X_FORWARDED_HOST=0
export DB_ENGINE=mysql
export DB_NAME=infrix
export DB_USER=infrix
export DB_HOST='<database-host>'
export DB_PORT=3306
export DB_PASSWORD='<database-password>'
export INFRIX_CONFIG_ENCRYPTION_KEY='<base64-fernet-key>'
```

Production requires a random `DJANGO_SECRET_KEY` of sufficient length. A fresh
installation may generate it after confirming that the target database is
empty. An existing installation must already have this value; it is never
regenerated during an upgrade.

`INFRIX_CONFIG_ENCRYPTION_KEY` encrypts LDAP bind passwords stored in the
database. Keep it in the protected environment file and include it in the
backup plan.

The environment file should use the reference location and permissions:

```bash
sudo install -d -o root -g infrix -m 750 /etc/infrix
sudo touch /etc/infrix/infrix.env
sudo chown root:infrix /etc/infrix/infrix.env
sudo chmod 640 /etc/infrix/infrix.env
```

If the file already exists, preserve its values and set `ENV_FILE` when using
a different path. Never print the file contents in logs or shared terminals.

## 3. Run the installation or upgrade

### 3.1 Configuration check

For an existing environment file, run the installer configuration check before
changing the system:

```bash
ENV_FILE=/etc/infrix/infrix.env ./deploy/install.sh --preflight
```

This checks the production configuration and does not modify the system or
database. Resolve every reported error before continuing.

### 3.2 Automatic installation

From the source root:

```bash
chmod +x deploy/install.sh
sudo -E ./deploy/install.sh
```

The default `INSTALL_MODE=auto` selects a new installation when no Infrix
runtime exists and an upgrade when an existing service, virtual environment,
database, or environment file is detected.

Use an explicit mode when required:

```bash
export INSTALL_MODE=fresh
sudo -E ./deploy/install.sh
```

```bash
export INSTALL_MODE=upgrade
sudo -E ./deploy/install.sh
```

The installer installs system packages, creates the `infrix` account and
application directory, prepares the Python environment, initializes or reuses
MariaDB, applies Django migrations, builds the frontend, collects static files,
configures systemd and Nginx, and starts the services.

During an upgrade it preserves `/etc/infrix/infrix.env` and business data,
creates a restricted database backup before migrations, and restarts the
services after the new files are ready.

For a fresh installation, the application-side sequence is source staging,
production environment configuration, an empty MariaDB check, Python/backend
dependency installation, `npm ci` and frontend build, `migrate`, and
`check_preset_roles`. The latter invokes `initialize_system_data` and verifies
the four preset roles. The installer then collects static files, writes the
Gunicorn/systemd and Nginx configuration, and starts the services. Create the
first administrator after startup. SMTP and LDAP are optional: configure SMTP
from **System Settings → SMTP** and LDAP from **Organization & Permissions →
LDAP / AD** when those integrations are needed.

The installer also creates and enables the daily notification digest timer.
It runs the digest command as the non-root `infrix` account at approximately
09:00 in the host's systemd timezone. The command exits without sending when
email delivery is disabled or no relevant alerts exist.

Optional variables include `APP_DIR`, `APP_USER`, `BACKUP_DIR`, `ENV_FILE`,
`SYSTEMD_UNIT_FILE`, `DIGEST_SERVICE_UNIT_FILE`, `DIGEST_TIMER_UNIT_FILE`,
`NGINX_CONF_FILE`, `SOURCE_DIR`, `PYTHON_BIN`,
`GUNICORN_WORKERS`, and `SKIP_MARIADB=1`. Use absolute paths for file and
directory overrides.

## 4. Use an external MariaDB server

Create the database and dedicated application account on the database server,
then configure the application host with:

```bash
export SKIP_MARIADB=1
export DB_ENGINE=mysql
export DB_NAME=infrix
export DB_USER=infrix
export DB_HOST='<database-host>'
export DB_PORT=3306
export DB_PASSWORD='<database-password>'
export INFRIX_CONFIG_ENCRYPTION_KEY='<base64-fernet-key>'
sudo -E ./deploy/install.sh
```

The database account must be able to create and alter the tables and indexes
required by Django migrations. Restrict database access with database grants
and network policy; never expose port 3306 to untrusted public clients.

Use `utf8mb4` and a compatible collation such as `utf8mb4_unicode_ci`.

## 5. Create an administrator and access the application

Create the first administrator through the application runtime:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

The standard application URLs are:

- Application: `https://<hostname>/`
- Administration: `https://<hostname>/admin/`
- API documentation: `https://<hostname>/api/docs/`

After the first login, complete the password change if requested, create the
organization and location data, then add assets and configure permissions.

SMTP is optional and does not block startup. Configure and test it from
**System Settings → SMTP**. To use the scheduled digest, explicitly enable it
under **System Settings → Notifications**, configure the recipients, and set
the public HTTPS application URL used in email links.

## 6. Configure LDAP / Active Directory

Open **Organization & Permissions → LDAP / AD** as an administrator. Configure
the directory type, server endpoints, security mode, Base DN, user search base,
login attribute, bind account, and bind password.

Use LDAPS or StartTLS for production directory connections. Run the connection
diagnosis before saving the configuration; it uses the current form and does
not enable LDAP. LDAP remains disabled until an administrator explicitly
enables it.

Keep `INFRIX_CONFIG_ENCRYPTION_KEY` available for the lifetime of the stored
LDAP configuration. If the key is lost, stored bind passwords cannot be
decrypted.

## 7. Deployment health checks

Check the services and configured endpoints:

```bash
sudo systemctl is-enabled infrix nginx mariadb infrix-notification-digest.timer
sudo systemctl is-active infrix nginx mariadb
sudo nginx -t
curl -fsS https://<hostname>/
curl -fsS https://<hostname>/api/v1/auth/csrf/
sudo journalctl -u infrix -n 100 --no-pager
```

These checks cover service state, environment-file wiring, production security
settings, migrations, static files, and HTTP endpoints. They do not replace
firewall, TLS gateway, certificate, or browser configuration checks.

## 8. Backups and daily operations

Back up the Infrix database and `/etc/infrix/infrix.env`, including
`DJANGO_SECRET_KEY` and `INFRIX_CONFIG_ENCRYPTION_KEY`. The database backup
also preserves system settings and uploaded branding images. Restrict the
backup directory to administrators and protect database dumps from public
access.

Common service commands:

```bash
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -f
```

Before an in-place upgrade, confirm that a recent database backup is readable.
Keep database migrations in place across upgrades; do not delete an already
applied migration file.

## 9. Troubleshooting

### The application service does not start

Inspect the service and recent logs:

```bash
sudo systemctl status infrix --no-pager
sudo journalctl -u infrix -n 100 --no-pager
```

Check the environment-file path, ownership, permissions, database connection,
virtual-environment path, migration state, and port conflicts.

### Database access is denied

Review `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in the
environment file. Confirm the database grant allows connections from the
application host and includes the permissions required by migrations.

### A migration cannot be applied

For an upgrade, preserve the database backup and inspect the reported migration
or permission error. Do not delete migration records. Run:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh migrate --noinput
sudo -u infrix ./run.sh showmigrations assets
```

### The frontend is stale or unavailable

Confirm that the frontend artifact exists, reload Nginx, and refresh the
browser:

```bash
[ -s /opt/infrix/frontend/dist/index.html ]
sudo nginx -t && sudo systemctl reload nginx
```

### Nginx returns HTTP 400 or redirects repeatedly

Check for conflicting Nginx server blocks, confirm the hostname is included in
`DJANGO_ALLOWED_HOSTS`, and ensure the HTTPS gateway writes one authoritative
`X-Forwarded-Proto` value. The internal Nginx listener must not be publicly
reachable.

## 10. Production security checklist

- Use `DJANGO_ENV=production` and `DJANGO_DEBUG=0`.
- Use HTTPS, secure session cookies, secure CSRF cookies, and explicit trusted
  CSRF origins.
- Keep `/etc/infrix/infrix.env` at `root:infrix` ownership with mode `640`.
- Bind Gunicorn and local MariaDB to loopback or another protected interface.
- Allow only required traffic through the host firewall and security groups.
- Keep SELinux enabled and grant only the required reverse-proxy permission.
- Back up the database, environment file, and LDAP encryption key regularly.
- Protect database passwords, certificates, private keys, logs, and backups.
