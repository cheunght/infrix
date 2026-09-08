# Infrix

中文文档：[中文 README](README.zh-CN.md) · [中文部署文档](docs/DEPLOYMENT.zh-CN.md)

Infrix is an IT asset management platform for tracking assets, infrastructure locations, maintenance, licenses, inventory, and audit history.

## Features

- User authentication, roles, and organization permissions.
- Asset records, asset details, Excel/CSV import preview, Excel export, and custom fields.
- Data centers, server rooms, racks, U-position allocation, rack visualization, and capacity statistics.
- Device categories, vendors, device types, tags, and dictionary management.
- Fault registration, repair workflows, repair costs, repair history, and repair-record export.
- Software license management.
- Inventory tasks, inventory details, historical records, and result export.
- Spare-part definitions, multi-location stock, and stock transactions.
- Audit logs and administrator tools.
- LDAP / Active Directory configuration, connection diagnosis, and on-demand user provisioning.
- System Settings for localization, security, SMTP, notifications, branding, and maintenance.
- SMTP test delivery and an optional daily notification digest.

## Deployment

The official automatic installation path supports Rocky Linux 9.x through
`deploy/install.sh`. It installs the application runtime, configures the
selected database, builds the frontend, and creates the systemd and Nginx
services.

For other Linux distributions, use the [manual deployment guide](docs/MANUAL_DEPLOYMENT.md).
The reference production architecture uses MySQL/MariaDB, Gunicorn, Nginx,
systemd, and an HTTPS gateway.

See the [Rocky Linux installation guide](docs/INSTALL_VM.md) for prerequisites,
installation, upgrades, database options, LDAP configuration, backups, and
troubleshooting.

### Remote source synchronization

From an administration terminal, synchronize the application source to a
remote host with:

```bash
./deploy-to-remote.sh <ssh-target> [remote-source-dir]
```

The default remote staging directory is `/tmp/infrix-src`. Any custom staging
directory must be writable by the SSH account. The installer later places the
application under `/opt/infrix` using `sudo`.

## v0.1 database baseline

The `v0.1.0` source tree freezes a clean fresh-install migration baseline. A
development database created from pre-baseline migration history must be
recreated for the v0.1 baseline; it is not an in-place upgrade target. This
instruction applies to pre-release development data only. Do not recreate a
production database, and do not imply that future `v0.1.x` production upgrades
may replace their data instead of providing explicit incremental migrations.

## Production configuration

Keep the production environment file at `/etc/infrix/infrix.env` or in another
protected location managed consistently by the service supervisor. A typical
configuration contains:

```dotenv
DJANGO_ENV=production
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<random-secret-at-least-50-characters>
DJANGO_ALLOWED_HOSTS=<hostname>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<hostname>
DJANGO_HTTPS_MODE=proxy
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
DJANGO_SECURE_HSTS_SECONDS=3600
DJANGO_USE_X_FORWARDED_HOST=0
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<database-password>
DB_HOST=<database-host>
DB_PORT=3306
INFRIX_CONFIG_ENCRYPTION_KEY=<base64-fernet-key>
```

Use a dedicated database account, do not expose the database or Gunicorn
listener publicly, and keep environment files, backups, certificates, and
private keys out of the source directory.

## LDAP / Active Directory

An administrator configures LDAP from **Organization & Permissions → LDAP / AD**.
`INFRIX_CONFIG_ENCRYPTION_KEY` must be present before a bind password is saved;
it encrypts the password stored in the database. New installations start with
LDAP disabled.

Use LDAPS or StartTLS for production directory connections. The connection
diagnosis uses the current unsaved form and does not save or enable LDAP.

## SMTP and notifications

SMTP is optional and is not required for application startup. Configure it from
**System Settings → SMTP**, save the settings, and use the test-email action to
verify the configuration. To enable the daily digest, configure its recipients
and public HTTPS application URL under **System Settings → Notifications**. The
installer schedules the digest command; it sends only when the digest is
explicitly enabled and relevant alerts exist.

## First login and daily operations

Create the first administrator with:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

Use the application URL configured for the deployment. After the first login,
complete the password change if requested, create the organization and
location data, then configure assets and permissions.

Common service commands:

```bash
sudo systemctl status infrix --no-pager
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -n 100 --no-pager
```

## Backups, upgrades, and troubleshooting

Back up the Infrix database and `/etc/infrix/infrix.env`, including the LDAP
encryption key. The database backup preserves system settings and uploaded
branding images. Before an in-place upgrade, confirm that a restricted database
backup is readable. Use `INSTALL_MODE=upgrade` for an existing installation;
the installer preserves the environment file and business data before applying
migrations.

For service, database, migration, frontend, Nginx, LDAP, and permission issues,
see the [deployment guide](docs/DEPLOYMENT.zh-CN.md) or the
[manual deployment guide](docs/MANUAL_DEPLOYMENT.md).
