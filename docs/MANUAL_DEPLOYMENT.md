# Manual Deployment

## Scope

This guide describes a distribution-agnostic manual deployment process for Infrix.

The official automatic installation path is narrower:

- Official automatic installation: Rocky Linux 9.x only, through `deploy/install.sh`.
- Manual deployment: any Linux environment that satisfies the application, database, filesystem, networking, reverse-proxy, process-management, and production-security requirements documented here.

“Distribution-agnostic” applies to the application-level requirements. It does not mean that Infrix has been automatically tested on every Linux distribution. The administrator is responsible for operating-system package installation, repository configuration, system-library availability, service-manager integration, reverse-proxy integration, and host security policy.

For the official Rocky Linux 9 automatic path, see [INSTALL_VM.md](INSTALL_VM.md).

## Reference Production Stack

The repository provides a reference implementation based on:

- Python and a dedicated virtual environment.
- MariaDB or a compatible MySQL server.
- Gunicorn serving the Django WSGI application.
- Nginx serving the frontend and proxying the backend.
- systemd supervising the application process.

The reference stack is not the same as a universal platform requirement. Experienced administrators may use equivalent components when they provide the same behavior, but this repository does not claim that alternative proxies or supervisors are tested integrations.

### Hard Requirements

The deployment must provide:

- A supported Python runtime and an isolated virtual environment.
- The Python dependencies declared in `backend/requirements.txt`.
- A MySQL-compatible production database with a dedicated application database and user.
- The production environment contract accepted by `scripts/check-production-config.py`.
- A non-root application process serving `config.wsgi:application`.
- Reliable process supervision with controlled start, stop, restart, and failure recovery.
- A reverse proxy or equivalent edge component that serves the frontend and routes backend requests correctly.
- HTTPS for production traffic and a verified trusted-proxy boundary when TLS terminates upstream.
- An empty target database for a fresh installation, or a verified database backup before an in-place upgrade.
- Restrictive permissions for secrets, database credentials, backups, and generated application files.

### Reference Implementation

The current repository supplies concrete configuration for Gunicorn, Nginx, and systemd. The official `deploy/verify-release.sh` checks that reference stack and should not be treated as a generic validator for an arbitrary supervisor or reverse proxy.

## Runtime Requirements

### Python

The repository setup and automatic deployment paths enforce Python 3.10 or newer.

Use a maintained Python version that is at least 3.10 and create a dedicated virtual environment for the application. The repository does not declare a single recommended minor version or a runtime image.

Install the version-constrained dependencies from the repository:

```bash
python3 -m venv /opt/infrix/backend/.venv
/opt/infrix/backend/.venv/bin/python -m pip install -r /opt/infrix/backend/requirements.txt
```

Do not install the application requirements into the system Python and do not use `sudo pip install`.

The current backend runtime requirements include Django, Django REST Framework, Django REST Framework Spectacular, django-filter, openpyxl, Gunicorn, and PyMySQL. Development-only pytest dependencies are maintained outside the public release source. The declared MySQL driver is PyMySQL; the repository does not declare a `mysqlclient` build dependency.

### Node.js and npm

Node.js 18 or newer and npm are required only when building the frontend from source. They are not backend runtime requirements.

The current production source-build flow is:

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
```

The build produces `frontend/dist`, which is served by the reverse proxy. The repository does not define a prebuilt offline bundle or a separate frontend artifact distribution model.

### System Capabilities and Libraries

Provide the basic capabilities required by the selected Linux environment:

- Process and filesystem management.
- TCP networking and DNS resolution.
- Python virtual-environment support and pip.
- Node.js/npm when building the frontend.
- A compatible MariaDB/MySQL client for connectivity and administration.
- An optional database administration client for operational backups.
- A compiler and development headers only if the chosen Python or system packages require building native extensions.

The current Python requirements use PyMySQL rather than `mysqlclient`, so MySQL client development headers are not a declared application requirement. Do not infer distribution-specific package names from this guide.

## Database Requirements

Production uses `DB_ENGINE=mysql`. Production SQLite, an empty database engine, and unknown database engines are rejected by the application configuration model and the production preflight.

Provide:

- MariaDB or a compatible MySQL server.
- A dedicated Infrix database.
- A dedicated application database user; do not run the application as the database root user.
- A reachable database host and port.
- The database must not be reachable from untrusted public clients. For a database on the application host, bind it to loopback; for an external database, enforce the equivalent restriction with database access controls and network policy.
- A database charset and collation compatible with the reference configuration: `utf8mb4` and `utf8mb4_unicode_ci`.
- Permissions sufficient for normal application reads/writes and Django migrations, including table and index creation or alteration.
- A `mariadb-dump`-compatible client with permission to back up the application database.

The repository does not pin one database server version range. Validate the selected server version, character set, authentication method, and client/server compatibility in the target environment before production use.

Create the database and user using the database administration process for your environment. The following SQL expresses the reference behavior; replace the host scope and password with values appropriate for the application host:

```sql
CREATE DATABASE infrix
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'infrix'@'application-host' IDENTIFIED BY '<database-password>';

GRANT ALL PRIVILEGES ON infrix.* TO 'infrix'@'application-host';
FLUSH PRIVILEGES;
```

The application process should use only the dedicated `infrix` account. Keep database administration credentials separate from `DB_USER` and `DB_PASSWORD`.

Verify connectivity with the same host, port, database, and user that will be placed in the production environment file:

```bash
MYSQL_PWD='<database-password>' mariadb \
  --protocol=tcp -h <database-host> -P 3306 -u infrix infrix \
  -e 'SELECT 1;'
```

Replace all placeholders before execution and avoid exposing passwords in shell history or shared process output.

## Filesystem and Permissions

The following are reference paths used by the supplied Rocky installer. Manual deployments may choose different paths unless a repository script or service definition explicitly references one.

| Purpose | Reference path | Required behavior |
| --- | --- | --- |
| Application source | `/opt/infrix` | Readable by the application user; source-controlled files must be reviewed before release. |
| Backend environment | `/etc/infrix/infrix.env` | Not world-readable; reference ownership `root:infrix`, mode `640`. |
| Backup directory | `/var/backups/infrix` | Restricted directory, reference mode `700`. |
| Database backups | `/var/backups/infrix/*.sql` | Restricted files, reference mode `600`. |
| Frontend build | `/opt/infrix/frontend/dist` | Readable by the reverse-proxy user; reference directories are `755` and files `644`. |
| Django static files | `/opt/infrix/backend/staticfiles` | Collected before service startup and readable by the reverse-proxy user. |
| Application logs | Supervisor/journal output | The current repository does not require a separate writable application log directory. |

Use a dedicated non-root application account such as `infrix`. The application account needs read access to the source, virtual environment, environment file, frontend build, and collected static files. It should have write access only where the application and deployment process genuinely require it.

Do not use `chmod 777` to solve ownership or access problems. Correct the owner, group, directory mode, or service identity instead.

## Deploy the Application Source

Deploy a reviewed release checkout or source snapshot to the application directory. The reference layout is:

```text
/opt/infrix/
  backend/
  frontend/
  deploy/
  scripts/
```

The frontend build is generated from source. `frontend/dist` and `frontend/node_modules` do not need to be committed or copied from a development workstation.

Release-side validation is separate from server deployment:

```bash
INFRIX_REPO_ROOT=/path/to/infrix-source \
INFRIX_PRIVATE_ROOT=/path/to/infrix-private \
/path/to/infrix-private/scripts/check-release.sh
```

The private `check-release.sh` is intended for a clean release/build checkout. It rejects a dirty Git working tree, prints the candidate commit SHA, checks production configuration, runs backend and frontend validation, and verifies the production build. A manual production server does not need to contain `.git` or the private development workspace.

## Production Environment

Use one production environment file for the application process. The reference path is `/etc/infrix/infrix.env`; a custom path is acceptable when the process supervisor and `INFIX_ENV_FILE` usage are configured consistently.

The production configuration model requires at least:

```dotenv
DJANGO_ENV=production
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<random-secret-at-least-50-characters>
DJANGO_ALLOWED_HOSTS=infrix.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://infrix.example.com
DJANGO_HTTPS_MODE=proxy
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
DJANGO_SECURE_HSTS_SECONDS=3600
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=0
DJANGO_SECURE_HSTS_PRELOAD=0
DJANGO_USE_X_FORWARDED_HOST=0
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<database-password>
DB_HOST=db.example.internal
DB_PORT=3306
INFRIX_CONFIG_ENCRYPTION_KEY=<base64-fernet-key>
```

Replace every placeholder. Production rejects short or placeholder secrets, wildcard hosts, non-HTTPS CSRF origins, insecure cookies, invalid HSTS values, forwarded-host trust, SQLite, unknown database engines, and incomplete MySQL settings.

Treat the environment file as sensitive configuration:

```bash
install -d -m 750 /etc/infrix
chown root:infrix /etc/infrix
chmod 750 /etc/infrix
test -f /etc/infrix/infrix.env || install -m 640 /dev/null /etc/infrix/infrix.env
chmod 640 /etc/infrix/infrix.env
chown root:infrix /etc/infrix/infrix.env
```

Do not print the secret or database password in logs. Do not store the real environment file in the source repository.

### LDAP / Active Directory configuration

`INFRIX_CONFIG_ENCRYPTION_KEY` is a deployment secret used to encrypt the LDAP
bind password stored in the database. Generate a Fernet key outside the
repository, keep it in the restricted environment file, and do not rotate it
without a planned re-encryption migration. The system administrator can then
configure the directory in Organization & Permissions → LDAP / AD. Fresh
installations start with LDAP disabled; no LDAP runtime environment variables
are required.

The settings page accepts hostnames or IP addresses and keeps the primary and
secondary endpoints separate from the security mode. Use LDAPS or StartTLS in
production. “Test connection” validates the current unsaved form and does not
enable LDAP or persist any value. An incomplete configuration cannot be
enabled, and disabling LDAP retains the configuration and existing sessions.

## Production Configuration Validation

Run the repository's production preflight before starting the application:

```bash
/opt/infrix/backend/.venv/bin/python /opt/infrix/scripts/check-production-config.py \
  --env-file /etc/infrix/infrix.env \
  --require-proxy
```

This is a mandatory production gate. If it fails, do not continue to migration, service startup, or public exposure.

For a separately designed direct-TLS reverse proxy, the application configuration model also supports `DJANGO_HTTPS_MODE=direct`, but that is not the current Rocky/Nginx reference deployment path. A direct-TLS deployment must independently prove that Django receives the correct secure-request behavior without trusting an unverified forwarded protocol header.

## Database Initialization

After the production environment passes validation:

1. Confirm that the database and dedicated application user exist.
2. Confirm the application host can connect using `DB_HOST`, `DB_PORT`, `DB_NAME`, and `DB_USER`.
3. Confirm that the database uses the required `utf8mb4` behavior.
4. Confirm that the database user has the privileges required by Django migrations.
5. For a fresh database, confirm that the target is empty before treating it as a new installation.
6. For an existing database, create and verify a backup before applying migrations.

Run migrations from the backend virtual environment:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py initialize_system_data
```

`initialize_system_data` is the repository's current application initialization command. Do not substitute an undocumented seed or bootstrap command.

## Frontend Build and Static Files

Build the frontend from the reviewed source checkout:

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
```

The public build runs the type check and Vite build through the current npm scripts. The private release gate runs the UI regression, i18n, and branding checks before that build. Confirm that the build produced:

```bash
test -s /opt/infrix/frontend/dist/index.html
```

Collect Django static files after the backend environment and database configuration are ready:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py collectstatic --noinput --clear
```

Ensure the reverse-proxy user can read `frontend/dist` and `backend/staticfiles`. Node.js and npm are not needed after the frontend build has completed unless the deployment process rebuilds the frontend again.

## Application Server

The WSGI entry point is `config.wsgi:application`. The reference Gunicorn command is:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/gunicorn \
  config.wsgi:application \
  --bind 127.0.0.1:8001 \
  --workers 3 \
  --timeout 120
```

Run Gunicorn as the dedicated non-root application user. Bind it to loopback, a protected Unix socket, or another internal-only interface. Do not expose the Gunicorn listener directly to the public Internet.

The reference timeout is 120 seconds. Equivalent reverse-proxy timeouts must not terminate valid requests prematurely, especially for imports and other larger operations. Adjust worker count and timeouts only after measuring the target workload.

## Process Supervision

Use reliable process supervision with controlled startup, shutdown, restart, and failure recovery. The reference implementation is systemd:

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

The environment file must be required. Do not use `EnvironmentFile=-/etc/infrix/infrix.env` or another optional form that allows the service to start without production settings.

Equivalent supervisors may be used by experienced administrators if they load the production environment, run the WSGI process as non-root, supervise failures, and provide an equivalent restart policy. The repository provides reference configuration and verification for systemd, not a generic supervisor integration.

## Reverse Proxy

The reference proxy is Nginx. It must:

- Serve the built SPA from `frontend/dist`.
- Serve collected Django static files from `backend/staticfiles`.
- Proxy `/api/` to Gunicorn.
- Proxy `/admin/` to Gunicorn.
- Preserve the validated Host value and forward client information.
- Forward one authoritative HTTPS indication.
- Enforce an appropriate request size limit; the reference configuration uses `client_max_body_size 50m`.
- Avoid exposing Gunicorn directly.

The current reference routing behavior is equivalent to:

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

This is a reference behavior description, not a promise that every Nginx version or custom configuration has been tested. The supplied `deploy/install.sh` remains the authoritative generated configuration for the Rocky automatic path.

## HTTPS and Trusted Proxy Boundary

Production traffic must use HTTPS. Certificate provisioning, TLS policy, and certificate renewal are administrator responsibilities; the repository does not automate Let's Encrypt or cloud certificate management.

Two deployment topologies are possible when their security behavior is independently verified:

### Direct TLS at the Reverse Proxy

```text
Client -> HTTPS reverse proxy -> Gunicorn
```

The reverse proxy terminates TLS and must pass secure-request information to Django without relying on an untrusted client header. The repository does not provide a complete direct-TLS production configuration; do not assume that setting `DJANGO_HTTPS_MODE=direct` alone is sufficient behind a custom proxy. This topology is not the current automatic installer path and requires separate end-to-end verification.

### External TLS Gateway

```text
Client -> trusted HTTPS gateway -> private Nginx -> Gunicorn
```

For the current reference topology:

- The external gateway terminates public TLS.
- The gateway overwrites `X-Forwarded-Proto` with exactly `https` or `http`.
- Private Nginx forwards the gateway-controlled value.
- The private Nginx listener accepts traffic only from the trusted gateway.
- Public clients cannot bypass the gateway and inject `X-Forwarded-Proto`.
- `DJANGO_HTTPS_MODE=proxy` is required.
- Firewall and Security Group rules are administered and verified outside the application repository.
- On hosts with SELinux or another mandatory access-control system, allow the reverse proxy to connect to the private Gunicorn listener without disabling enforcement or weakening file permissions.

Do not trust arbitrary forwarded headers, expose the internal Nginx listener to the public Internet, or treat a private HTTP hop as proof that the original request was HTTPS.

## Fresh Installation and In-Place Upgrade

A manual fresh deployment should follow this order:

1. Prepare a Linux host that satisfies the runtime and security requirements.
2. Deploy a reviewed source release.
3. Create a dedicated application user and reference application directories.
4. Create the Python virtual environment and install `backend/requirements.txt`.
5. Create the production environment file with restrictive ownership and permissions.
6. Run `scripts/check-production-config.py`; stop if it fails.
7. Create and validate the dedicated MySQL/MariaDB database and user.
8. Confirm the fresh database is empty.
9. Build the frontend with `npm ci` and `npm run build`.
10. Run `manage.py migrate --noinput`.
11. Run `manage.py initialize_system_data`.
12. Run `manage.py collectstatic --noinput --clear`.
13. Install or configure the process supervisor with a required environment file.
14. Configure the reverse proxy and HTTPS boundary.
15. Start the application and complete the verification checklist.

Do not run the application as root, use the database root account at runtime, publish Gunicorn, or skip production configuration validation.

For an in-place upgrade from the Infrix baseline:

1. Put the reviewed release source in a staging directory; do not overwrite the live application directory by hand.
2. Verify that `/etc/infrix/infrix.env` is present, complete, and contains the existing `DJANGO_SECRET_KEY`.
3. Confirm that the database backup destination is restricted and has enough free space.
4. Stop the application service before replacing source code or applying migrations.
5. Create and verify a `mariadb-dump`/`mysqldump` backup, or an SQLite file backup for a development deployment.
6. Synchronize the reviewed source, install the declared dependencies, and build the frontend.
7. Run `manage.py migrate --noinput`, `manage.py check`, and the deployment verification checks.
8. Start the service and complete the application smoke test.

Future releases must retain every migration file that has already been released from this baseline. Additive Django migrations are the supported upgrade mechanism; do not delete or rename an applied migration file.

## Installation and upgrade boundary

This release is the Infrix installation baseline. A fresh deployment uses the single current initial migration and requires an empty target database. Later releases may be installed in place when their migration set contains the applied baseline migrations and any new migrations needed for the release.

The repository does not promise an upgrade path from a pre-baseline database whose migration files have been removed from the current source. The automatic installer checks the database migration ledger and stops before replacing application code when it finds an unavailable applied migration.

Database backups are mandatory before an in-place upgrade. Keep multiple restricted backup generations and verify that at least one can be restored in a separate environment.

Run release-side checks against the candidate source before installation:

```bash
INFRIX_REPO_ROOT=/path/to/infrix-source \
INFRIX_PRIVATE_ROOT=/path/to/infrix-private \
/path/to/infrix-private/scripts/check-release.sh
```

The production environment preflight and deployment verification are separate from release-side Git traceability. A production server does not need a clean Git checkout if the release has already been validated elsewhere and the reviewed source has been transferred.

## Verification

Complete all applicable checks before declaring the deployment ready:

- Production configuration validation passes without printing secrets.
- The application can connect to the configured database.
- All expected migrations are applied:

  ```bash
  cd /opt/infrix/backend
  /opt/infrix/backend/.venv/bin/python manage.py showmigrations --plan
  ```

- `manage.py check` passes.
- `frontend/dist/index.html` exists and is readable by the reverse-proxy user.
- Collected static files exist and are readable by the reverse-proxy user.
- The application process is healthy and runs as a non-root user.
- Gunicorn is bound only to loopback, a protected socket, or another internal-only interface.
- The reverse proxy serves the SPA and static assets.
- `/api/v1/auth/csrf/` is reachable through the intended proxy path.
- The public endpoint uses HTTPS.
- Login, admin routing, API routing, and browser refreshes on SPA routes work.
- For a fresh deployment, the target database is empty and the current initial migration completes successfully; for an upgrade, a verified backup exists and all expected migrations are applied.
- Environment, backup, application, and static-file permissions are restrictive.
- Firewall, Security Group, TLS, gateway bypass prevention, and trusted-header behavior have been verified.

`deploy/verify-release.sh` may be used when the deployment matches the supplied systemd and Nginx reference stack. It checks service state, the required systemd environment file, the Nginx proxy contract, Django deployment checks, migrations, core data tables, static resources, and HTTP endpoints. It is not a generic validator for a custom supervisor or reverse proxy.

## Troubleshooting

### Configuration preflight fails

Read the error without printing the environment file. Check the production values for `DJANGO_ENV`, `DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, allowed hosts, HTTPS CSRF origins, cookie settings, HSTS, forwarded-host policy, and all MySQL fields. Do not bypass the validator by switching production to SQLite or by using a placeholder secret.

### Database connection fails

Verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and the database password. Confirm that the database user is allowed to connect from the application host and has the privileges required by migrations. Test with the same client network path used by the application.

### A Django migration fails

For a fresh deployment, confirm that the target database is empty. For an upgrade, confirm that a recent database backup exists and that every migration already recorded in `django_migrations` is present in the reviewed source. In both cases, confirm that the application user can create or alter tables and indexes and that the current migration set exists in `backend/assets/migrations/`. Then run:

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py showmigrations assets
```

### Frontend is stale or missing

Re-run `npm ci` and `npm run build` from the reviewed source. Confirm `frontend/dist/index.html` exists, that the reverse-proxy user can read it, and that the proxy's SPA fallback routes to `index.html`.

### HTTPS redirects loop or Django reports an insecure request

Verify the TLS termination point and the trusted-header boundary. In gateway mode, the gateway must overwrite `X-Forwarded-Proto` with one value and the internal listener must not be publicly reachable. Confirm `DJANGO_HTTPS_MODE=proxy` and that the proxy sends the header expected by Django.

### Application process is not healthy

Inspect the supervisor status and logs, then check database connectivity, environment-file permissions, migration status, the WSGI entry point, the virtual-environment path, and port/socket conflicts. Do not solve startup failures by running Gunicorn as root or making directories world-writable.

## What Infrix Does Not Manage

Manual deployment owners remain responsible for:

- Linux distribution package installation and system-library provisioning.
- Operating-system updates and runtime version maintenance.
- Database server lifecycle, credentials, users, privileges, backups, retention, off-site copies, and restore drills.
- TLS certificates, certificate renewal, and public HTTPS policy.
- Firewall and cloud Security Group configuration.
- SELinux policy and host hardening.
- Custom process supervisors or reverse proxies.
- Secret storage and rotation.
- Monitoring, alerting, log retention, and incident response.
- Release publication, GitHub permissions, branch protection, and CI/CD policy.

The repository does not add automatic installation support for other Linux distributions, Docker, Kubernetes, Helm, Ansible, Terraform, offline bundles, RPM/DEB packaging, private package repositories, automatic Let's Encrypt, or cloud firewall automation.
