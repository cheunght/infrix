# Manual Deployment

This guide describes a distribution-independent production deployment of
Infrix. It covers the application runtime, database, environment file,
process supervision, reverse proxy, LDAP, upgrades, backups, and operations.

The automatic installation path is available for Rocky Linux 9.x through
`deploy/install.sh`; see [INSTALL_VM.md](INSTALL_VM.md). Use this guide when
the operating system or service layout is managed manually.

For the Chinese version, see [中文手工部署文档](MANUAL_DEPLOYMENT.zh-CN.md).
For first-install wizard behavior, resumable installation, release packages,
and HTTPS diagnosis, see [Installer Workflow](INSTALLER_WORKFLOW.md).

## v0.1 migration baseline

The `v0.1.0` source tree is a clean fresh-install migration baseline. A
development database created from pre-baseline migration history must be
recreated for the v0.1 baseline; it is not an in-place upgrade target. This
does not authorize recreating production data: future `v0.1.x` releases must
provide explicit incremental migrations for existing production databases.

## 1. Production architecture

The reference deployment uses:

- Python 3.10 or newer and a dedicated virtual environment.
- MariaDB or a compatible MySQL server.
- Gunicorn serving the Django application.
- Nginx serving the frontend and forwarding API requests.
- systemd supervising the application process.
- An HTTPS gateway or TLS-enabled reverse proxy.

Equivalent components may be used when they provide the same security and
runtime behavior. The deployment must provide:

- A non-root application process serving `config.wsgi:application`.
- Reliable process supervision with controlled restart and failure recovery.
- A reverse proxy that serves the frontend and routes backend requests.
- HTTPS for production traffic and a trusted proxy boundary when TLS ends
  upstream.
- An empty database for a new installation, or a verified backup before an
  in-place upgrade.
- Restrictive permissions for secrets, database credentials, backups, and
  generated application files.

## 2. Runtime requirements

### Python

Use Python 3.10 or newer and create an isolated environment for Infrix:

```bash
python3 -m venv /opt/infrix/backend/.venv
/opt/infrix/backend/.venv/bin/python -m pip install -r /opt/infrix/backend/requirements.txt
```

Do not install application requirements into the system Python or use
`sudo pip install`.

### Node.js and npm

Node.js 18 or newer and npm are required to build the frontend from source:

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
```

The build produces `frontend/dist`, which is served by the reverse proxy.

### System capabilities

Provide process and filesystem management, TCP networking, DNS resolution,
Python virtual-environment support, a compatible MariaDB/MySQL client, and
the system libraries required by the selected operating system packages.

## 3. Database requirements

Production uses `DB_ENGINE=mysql`. Provide a MariaDB or compatible MySQL
server with:

- A dedicated Infrix database.
- A dedicated application account; do not run the application as database root.
- A reachable host and port protected by grants and network policy.
- `utf8mb4` and a compatible collation such as `utf8mb4_unicode_ci`.
- Permissions for normal reads/writes and Django table and index migrations.
- A `mariadb-dump`-compatible client for backups.

For a database managed separately from the application host, create the
database and account according to the database administrator's policy. The
following SQL shows the required relationship:

```sql
CREATE DATABASE infrix
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'infrix'@'application-host' IDENTIFIED BY '<database-password>';

GRANT ALL PRIVILEGES ON infrix.* TO 'infrix'@'application-host';
FLUSH PRIVILEGES;
```

Keep database administration credentials separate from `DB_USER` and
`DB_PASSWORD`. Verify connectivity with the same values used by the service:

```bash
MYSQL_PWD='<database-password>' mariadb \
  --protocol=tcp -h <database-host> -P 3306 -u infrix infrix \
  -e 'SELECT 1;'
```

Do not expose database passwords in logs, shared process listings, or shared
terminals.

## 4. Filesystem and permissions

The following paths match the supplied service layout. A manual deployment
may use equivalent paths when every service reference is updated consistently.

| Purpose | Reference path | Required behavior |
| --- | --- | --- |
| Application source | `/opt/infrix` | Readable by the application account. |
| Environment file | `/etc/infrix/infrix.env` | Owned by `root:infrix`, mode `640`. |
| Backup directory | `/var/backups/infrix` | Restricted directory, preferably mode `700`. |
| Database dumps | `/var/backups/infrix/*.sql` | Restricted files, preferably mode `600`. |
| Frontend build | `/opt/infrix/frontend/dist` | Readable by the reverse-proxy account. |
| Django static files | `/opt/infrix/backend/staticfiles` | Collected before service startup. |

Use a dedicated non-root application account such as `infrix`. Grant it only
the read and write access required by the application and deployment process.
Do not use `chmod 777`; correct ownership, group membership, directory mode, or
service identity instead.

## 5. Deploy the application source

Place the application source in the selected application directory. The
reference layout is:

```text
/opt/infrix/
  backend/
  frontend/
  deploy/
  scripts/
```

The frontend build directory and dependency directory are generated on the
deployment host and do not need to be supplied with the source package.

## 6. Configure the production environment

Use one production environment file for the application process. The reference
file is `/etc/infrix/infrix.env`; a different path is valid when the process
supervisor and `INFIX_ENV_FILE` usage are configured consistently. Use the
repository's [`deploy/infrix.env.example`](../deploy/infrix.env.example) as the
field reference instead of maintaining a second configuration sample here.

Production rejects short or placeholder secrets, wildcard hosts, non-HTTPS
CSRF origins, insecure cookies, invalid proxy settings, and incomplete MySQL
settings.

Create the environment directory and restrict the file:

```bash
install -d -m 750 /etc/infrix
chown root:infrix /etc/infrix
chmod 750 /etc/infrix
touch /etc/infrix/infrix.env
chmod 640 /etc/infrix/infrix.env
chown root:infrix /etc/infrix/infrix.env
```

Do not store the real environment file in the source directory or print its
contents to logs.

Generate a Fernet key once and keep it with the environment-file and database
backups:

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

### LDAP / Active Directory

`INFRIX_CONFIG_ENCRYPTION_KEY` encrypts the LDAP bind password stored in the
database. Generate and store this key outside the source directory, protect
it in the environment file, and include it in the backup plan.

An administrator configures the directory from **Organization & Permissions →
LDAP / AD**. Configure the directory type, server endpoints, security mode,
Base DN, user search base, login attribute, bind account, and bind password.
Use LDAPS or StartTLS for production. Run the connection diagnosis before
saving; it uses the current form and does not enable LDAP. LDAP remains
disabled until an administrator explicitly enables it.

SMTP is optional and is not required for application startup. Configure and
test it from **System Settings → SMTP**. If the daily digest is needed, enable
it under **System Settings → Notifications**, configure the recipients, and set
the public HTTPS application URL used in email links.

### People and asset users

The **Organization & Permissions** tabs are ordered as Users, People,
Departments, Roles, and LDAP / AD. The available tabs depend on the current
account's permissions.

People records can exist without login accounts. Each record has a required
name and optional employee number, department, organization, contact details,
and active status. When creating a local account, an administrator can link an
existing unlinked person. If no person is selected, the account creation flow
creates a person record automatically.

Assets have one optional assigned person. Select a person while creating or
editing an asset, or use the asset detail actions to assign, transfer, or
return it. Only active people can be assigned. A transfer writes an assignment
history entry and leaves the asset status unchanged. The person's department
is profile information and is not stored as an asset ownership field.

The asset import fields `assigned_person_employee_no`,
`assigned_person_name`, `assigned_person_department`, and `assignment_reason`
match an existing person. Imports do not create people. Asset exports include
the assigned person's name, employee number, department, organization, and
contact details.

## 7. Production configuration check

Run the configuration check before starting the application:

```bash
/opt/infrix/backend/.venv/bin/python /opt/infrix/scripts/check-production-config.py \
  --env-file /etc/infrix/infrix.env \
  --require-proxy
```

Resolve every reported error before migration, service startup, or public
exposure.

## 8. Initialize the database and static files

For a new database, confirm that the target is empty. For an existing
installation, create and verify a restricted database backup before applying
migrations.

Run the application migrations and initialization:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py initialize_system_data
/opt/infrix/backend/.venv/bin/python manage.py collectstatic --noinput --clear
```

## 9. Application server and process supervision

The WSGI entry point is `config.wsgi:application`. The reference Gunicorn
command is:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/gunicorn \
  config.wsgi:application \
  --bind 127.0.0.1:8001 \
  --workers 3 \
  --timeout 120
```

Run Gunicorn as the dedicated non-root application account and bind it only to
loopback, a protected socket, or another internal interface.

The reference systemd unit is:

```ini
[Unit]
Description=Infrix Django API
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=infrix
Group=infrix
WorkingDirectory=/opt/infrix/backend
EnvironmentFile=/etc/infrix/infrix.env
ExecStart=/opt/infrix/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8001 --workers 3 --timeout 120
Restart=always
RestartSec=5
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

The environment file must be required. Do not use an optional
`EnvironmentFile=-/etc/infrix/infrix.env` form.

### Daily notification digest

SMTP is optional. When it is configured, open **System Settings → Notifications** and
explicitly enable the daily digest, enter its recipient list, and provide the
public HTTPS application URL used in email links. The digest is sent only for
enabled alert categories and an empty digest is not sent.

For manual deployments, create a service using the same application account
and environment file:

```ini
[Unit]
Description=Infrix daily notification digest
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=oneshot
User=infrix
Group=infrix
WorkingDirectory=/opt/infrix/backend
EnvironmentFile=/etc/infrix/infrix.env
ExecStart=/opt/infrix/backend/.venv/bin/python manage.py send_notification_digest
PrivateTmp=true
NoNewPrivileges=true
```

Schedule it with a systemd timer at the organization's preferred daily time.
The reference automatic installer uses `09:00` and a small randomized delay:

```ini
[Unit]
Description=Infrix daily notification digest schedule

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=15m
Unit=infrix-notification-digest.service

[Install]
WantedBy=timers.target
```

Save the units as `infrix-notification-digest.service` and
`infrix-notification-digest.timer`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infrix-notification-digest.timer
sudo systemctl status infrix-notification-digest.timer --no-pager
```

Run the command manually when needed:

```bash
sudo -u infrix /opt/infrix/backend/.venv/bin/python /opt/infrix/backend/manage.py send_notification_digest
```

## 10. Reverse proxy and HTTPS

The reverse proxy must:

- Serve the frontend from `frontend/dist`.
- Serve Django static files from `backend/staticfiles`.
- Forward `/api/` and `/admin/` to Gunicorn.
- Preserve the validated Host value and client information.
- Forward one authoritative HTTPS indication.
- Enforce an appropriate request size limit; the reference is `50m`.
- Keep Gunicorn inaccessible to public clients.

A reference Nginx routing layout is:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
}

location /admin/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
}

location /static/ {
    alias /opt/infrix/backend/staticfiles/;
}

location / {
    try_files $uri /index.html;
}
```

Production traffic must use HTTPS. When an external gateway terminates TLS,
it must overwrite `X-Forwarded-Proto` with one value and only the trusted
gateway may reach the internal Nginx listener. Set `DJANGO_HTTPS_MODE=proxy`.

If Nginx terminates TLS directly, configure the certificate and secure-request
headers in Nginx and ensure Django receives the correct secure-request state.
Do not trust arbitrary client-supplied forwarded headers.

## 11. Installation and upgrade procedure

For a new installation:

1. Prepare the Linux host, database, source directory, and application account.
2. Create the restricted production environment file.
3. Run the production configuration check.
4. Confirm the new database is empty.
5. Create the virtual environment and install backend requirements.
6. Build the frontend and collect Django static files.
7. Apply migrations and initialize application data.
8. Configure systemd, Nginx, and HTTPS.
9. Start the service and complete the deployment health checks.

For an in-place upgrade:

1. Put the new source in a staging directory; do not overwrite the live directory.
2. Confirm `/etc/infrix/infrix.env` is present and contains the existing secret.
3. Create and verify a restricted MariaDB backup.
4. Stop the application service before replacing files or applying migrations.
5. Synchronize the source, install dependencies, and rebuild the frontend.
6. Run `manage.py migrate --noinput` and `manage.py check`.
7. Start the service and complete the deployment health checks.

Keep every migration file that has already been applied. If the database
contains a migration record whose file is absent from the application source,
stop and restore a compatible source or migration path before changing the
database.

## 12. Deployment health checks

Complete the applicable checks before making the application available:

- The production configuration check passes without printing secrets.
- The application connects to the configured database.
- Expected migrations are applied and `manage.py check` succeeds.
- `frontend/dist/index.html` and collected static files are readable.
- The application runs as a non-root account.
- Gunicorn is bound only to a protected internal interface.
- Nginx serves the SPA and static assets and forwards API requests.
- `/api/v1/auth/csrf/` is reachable through the intended HTTPS path.
- Login, administration, API routing, and browser refreshes work.
- Firewall, TLS gateway, certificate, and trusted-header rules are correct.

## 13. Backups and daily operations

Back up the Infrix database and `/etc/infrix/infrix.env`, including the LDAP
encryption key. The database backup also preserves system settings and uploaded
branding images. Restrict the backup directory to administrators and retain
multiple generations according to the organization's policy.

A MariaDB backup can be created with:

```bash
sudo bash -c 'f=/var/backups/infrix/database-$(date +%Y%m%d-%H%M%S).sql; mariadb-dump --protocol=socket -uroot --single-transaction --quick --triggers --hex-blob infrix > "$f"; chmod 600 "$f"'
```

Common service commands:

```bash
sudo systemctl status infrix --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -n 100 --no-pager
sudo journalctl -u infrix -f
```

## 14. Troubleshooting

### Configuration check fails

Read the error without printing the environment file. Check the production
values for `DJANGO_ENV`, `DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, allowed hosts,
HTTPS CSRF origins, cookie settings, HSTS, proxy settings, and all MySQL fields.

### Database connection fails

Verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and the database password.
Confirm the account grant allows connections from the application host and has
the permissions required by migrations.

### A migration fails

For a new installation, confirm the database is empty. For an upgrade, confirm
a recent backup exists and that every recorded migration file is present in the
source. Confirm that the application account can create and alter tables and
indexes, then run:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py showmigrations assets
```

### The frontend is stale or unavailable

Rebuild the frontend, confirm `frontend/dist/index.html` exists, reload Nginx,
and refresh the browser:

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
[ -s /opt/infrix/frontend/dist/index.html ]
sudo nginx -t && sudo systemctl reload nginx
```

### Nginx returns HTTP 400 or redirects repeatedly

Check for conflicting server blocks, confirm the hostname is included in
`DJANGO_ALLOWED_HOSTS`, and ensure the HTTPS gateway writes one authoritative
`X-Forwarded-Proto` value. The internal listener must not be publicly reachable.

### The application service is unavailable

Inspect the service status and logs, then check the environment-file path and
permissions, database connectivity, migration state, WSGI path, virtual
environment, and port conflicts.

## 15. Deployment responsibilities

The deployment administrator remains responsible for:

- Operating-system packages, updates, and runtime maintenance.
- Database lifecycle, credentials, grants, backups, retention, and recovery.
- TLS certificates, renewal, and HTTPS policy.
- Firewall and cloud security-group configuration.
- SELinux policy and host hardening.
- Custom process supervisors or reverse proxies.
- Secret storage and rotation.
- Monitoring, alerting, log retention, and incident response.

The supplied automatic installer does not configure unrelated infrastructure
such as cloud firewalls, certificate authorities, or custom orchestration systems.
