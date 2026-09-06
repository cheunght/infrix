# Rocky Linux 9 Official Automatic Installation and Upgrade Guide

This guide describes how to deploy or upgrade Infrix on a Rocky Linux 9 virtual machine. The installer provisions the application runtime, Python environment, frontend build, systemd service, Nginx configuration, and—when requested—local MariaDB.

This is the official automatic-installation guide. `deploy/install.sh` is the single automatic installation entry point and supports Rocky Linux 9.x only. It verifies `/etc/os-release` and accepts `ID=rocky` with `VERSION_ID=9`, `9.x`, or `9.<minor>`. Other Linux environments must use the distribution-agnostic [Manual Deployment Guide](MANUAL_DEPLOYMENT.md).

The manual guide describes application-level requirements rather than a distribution support list. It does not imply that Infrix has been automatically tested on every Linux distribution.

The repository contains source code, migrations, configuration templates, and required assets only. It does not contain SQLite or MySQL data, user accounts, secrets, virtual environments, frontend dependencies, or build output. A private GitHub checkout must be configured again on the target host according to this guide.

The installer preserves SELinux enforcement. When SELinux is Enforcing or Permissive, it verifies and persistently enables the narrowly required `httpd_can_network_connect` boolean so Nginx can proxy to Gunicorn; it never runs `setenforce 0` and never uses `chmod 777`. For a local MariaDB deployment it also binds the database to `127.0.0.1` and stops if port 3306 is listening on a non-loopback address. Firewall, Security Group, and external TLS controls remain the deployment owner's responsibility.

## Deployment Contract

The supported production path is:

- An external HTTPS gateway terminates public TLS.
- The private Nginx listener accepts TCP port 80 only from that trusted gateway.
- The gateway overwrites `X-Forwarded-Proto` with one authoritative value: `https` or `http`.
- Nginx forwards that value to Django.
- Django runs with `DJANGO_HTTPS_MODE=proxy` and production security settings enabled.

Do not expose the internal port 80 listener directly to untrusted clients. The installer and production release gate require proxy mode for this Nginx deployment. If Nginx itself must terminate TLS, design and verify a separate direct-TLS deployment instead of applying this internal HTTP configuration unchanged.

## Before You Begin

- A fresh MySQL installation must confirm that the target database is empty before it can generate a new secret or migrate.
- An existing Infrix installation is upgraded in place by default. The installer preserves the environment file and business data, creates a database backup before migration, and applies the current Django migration set.
- Upgrades are supported from the Infrix baseline represented by the current migration files. If the database contains migration records whose files are not present in the reviewed package, the installer stops before replacing application code.
- The installer initializes four preset roles: System Administrator, Asset Administrator, Maintenance Operator, and Read-only Auditor. Preset roles cannot be renamed or deleted.
- Existing superusers are assigned to System Administrator. Other existing accounts default to Read-only Auditor. Verify every account after deployment.
- Data centers, server rooms, and racks must be created in the application before assets are entered or imported. Asset import does not create missing location master data.
- The installer runs the current Django migrations, preset-role checks, Django checks, static-file checks, and HTTP health checks.
- The installer prints pre- and post-initialization counts for key business tables.

## 1. Prerequisites

The target host must meet these conditions:

- Rocky Linux 9 with root access or an account that can run the installer with `sudo`.
- Access to the Rocky Linux package repositories and the Python/npm package registries.
- TCP port 80 restricted to the trusted HTTPS gateway.
- A complete source tree containing at least `backend/manage.py`, `backend/requirements.txt`, `frontend/package.json`, and `frontend/package-lock.json`.
- At least Python 3.10 and Node.js 18 available, or permission for the installer to install them.
- For local MariaDB mode, the installer must be allowed to manage the MariaDB listener and keep TCP port 3306 loopback-only.

## 2. Obtain the Source

Clone the repository to a staging directory:

```bash
sudo -i
dnf install -y git
git clone <repository-url> /tmp/infrix-src
cd /tmp/infrix-src
```

If the source has already been uploaded, enter the project root directly:

```bash
cd /tmp/infrix-src
```

Do not place `/etc/infrix/infrix.env` inside the source tree. Do not commit database files, secrets, backups, or generated dependencies.

## 3. Installation and Upgrade

### 3.1 Configure Deployment Variables

The following example uses `infrix.example.com` as the public HTTPS host. Replace it with the real hostname or IP address before running the installer.

```bash
export SERVER_NAME=infrix.example.com
export DJANGO_ENV=production
export DJANGO_DEBUG=0
export DJANGO_ALLOWED_HOSTS='infrix.example.com'
export DJANGO_CSRF_TRUSTED_ORIGINS='https://infrix.example.com'
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
export DB_HOST=127.0.0.1
export DB_PASSWORD='<database-password>'
export DB_PORT=3306
export INFRIX_CONFIG_ENCRYPTION_KEY='<base64-fernet-key>'
```

Replace the database password and Fernet key with real values before execution. Do not put either secret into the repository or a shell history that is accessible to other users. The encryption key is retained in the generated environment file for database-managed LDAP secrets.

Production requires an explicit MySQL/MariaDB configuration. `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST` must be non-empty. SQLite, an empty `DB_ENGINE`, an unknown database engine, wildcard `DJANGO_ALLOWED_HOSTS`, non-HTTPS CSRF origins, insecure cookies, and invalid proxy settings are rejected.

On a fresh production installation, `DJANGO_SECRET_KEY` may be omitted and will be generated only after the installer confirms that the target MySQL database is empty. You may provide a random secret of at least 50 characters instead. Never omit the secret from an existing production environment file: an existing installation with a missing secret is a hard failure.

If `/etc/infrix/infrix.env` already exists, the installer loads that file and preserves its values. Exported variables do not override values already present in the environment file.

For a Rocky Linux host used as a development environment, configure it explicitly as development. This mode keeps the local HTTP and SQLite workflow:

```bash
export DJANGO_ENV=development
export DJANGO_DEBUG=1
export DJANGO_ALLOWED_HOSTS='*'
export DJANGO_CSRF_TRUSTED_ORIGINS='http://127.0.0.1,http://localhost'
export DJANGO_HTTPS_MODE=direct
export DJANGO_SECURE_SSL_REDIRECT=0
export DJANGO_SESSION_COOKIE_SECURE=0
export DJANGO_CSRF_COOKIE_SECURE=0
export DJANGO_SECURE_HSTS_SECONDS=0
export DJANGO_USE_X_FORWARDED_HOST=0
export DB_ENGINE=sqlite
```

If `DJANGO_ALLOWED_HOSTS` is omitted in development mode, the installer defaults to `127.0.0.1,localhost`. When the application will be opened from another host, set `SERVER_NAME` or `DJANGO_ALLOWED_HOSTS` to the test host explicitly; use `DJANGO_ALLOWED_HOSTS='*'` only for an isolated development network.

Optional deployment variables:

```bash
export APP_DIR=/opt/infrix
export APP_USER=infrix
export BACKUP_DIR=/var/backups/infrix
export GUNICORN_WORKERS=3
```

`INSTALL_MODE=auto` is the default. It selects `fresh` when no Infrix runtime is detected and `upgrade` when the target already has an Infrix service, virtual environment, database, or environment file. A source tree alone is not an installed runtime, so a staged or interrupted source synchronization can be reused for a fresh installation. To make the intent explicit, use `INSTALL_MODE=fresh` for a new target or `INSTALL_MODE=upgrade` for an existing baseline installation.

The installer also accepts `ENV_FILE`, `SYSTEMD_UNIT_FILE`, `NGINX_CONF_FILE`, `SOURCE_DIR`, `PYTHON_BIN`, `SKIP_MARIADB`, and `BACKUP_DIR`. Use absolute paths for file and directory overrides.

### 3.2 Run the Production Preflight

Before installing system packages or writing system configuration, validate an existing environment file:

```bash
ENV_FILE=/etc/infrix/infrix.env ./deploy/install.sh --preflight
```

Preflight validates the production contract and does not modify the system or database. It requires the environment file to exist and requires the current Nginx deployment's proxy mode.

`--preflight` is a configuration-only check and intentionally does not perform the Rocky Linux host check. Running it on another platform does not make that platform an automatically supported installation target.

### 3.3 Run the Installer

Make the script executable and run it with the exported variables preserved through `sudo`:

```bash
chmod +x deploy/install.sh
sudo -E ./deploy/install.sh
```

The default `INSTALL_MODE=auto` selects the correct path. For a fresh target, you may make the choice explicit:

```bash
export INSTALL_MODE=fresh
sudo -E ./deploy/install.sh
```

For an existing Infrix baseline installation, use the upgrade path explicitly when desired:

```bash
export INSTALL_MODE=upgrade
sudo -E ./deploy/install.sh
```

The installer runs in this order:

1. Validate the source tree, target paths, environment mode, and database contract.
2. Install system packages, including Python, Node.js, Nginx, and MariaDB packages when required.
3. For an upgrade, stop the active Infrix service, verify the existing migration ledger against the baseline, and create a restricted database backup.
4. Create the `infrix` system user and application directory, then synchronize the reviewed source tree.
5. Create or load the production environment file; existing environment values and secrets are preserved. If the existing systemd unit points to a different environment-file path and `ENV_FILE` was not explicitly set, that path is reused.
6. Start and initialize local MariaDB, unless `SKIP_MARIADB=1` or SQLite development mode is selected.
7. For a fresh MySQL install, verify that the target database contains no tables.
8. Create `backend/.venv` and install the backend requirements.
9. Run `npm ci` and `npm run build`; the deployment stops if the frontend build does not produce `frontend/dist/index.html`.
10. Run the current Django migrations, system checks, preset-role checks, and static-file collection.
11. Write the systemd unit with a required `EnvironmentFile`, write the Nginx reverse-proxy configuration, and validate Nginx syntax.
12. Enable the services and run API and frontend health checks.

The generated service runs Gunicorn on the private application port and serves the built frontend through Nginx. If a health check fails, the installer prints the service status and recent Gunicorn logs and exits non-zero.

If `/etc/nginx/conf.d/default.conf` conflicts with the Infrix configuration, the installer moves it into `BACKUP_DIR` before disabling it. Existing sites that use port 80 must be reviewed manually; Infrix uses `SERVER_NAME` for precise host matching when it cannot claim the default server.

## 4. Use an External MariaDB Server

Create the database and application user on the external database server, then configure the application host as follows:

```bash
export SKIP_MARIADB=1
export DJANGO_ENV=production
export DJANGO_DEBUG=0
export DJANGO_ALLOWED_HOSTS='infrix.example.com'
export DJANGO_CSRF_TRUSTED_ORIGINS='https://infrix.example.com'
export DJANGO_HTTPS_MODE=proxy
export DB_ENGINE=mysql
export DB_HOST=db.example.internal
export DB_PORT=3306
export DB_NAME=infrix
export DB_USER=infrix
export DB_PASSWORD='<database-password>'
export INFRIX_CONFIG_ENCRYPTION_KEY='<base64-fernet-key>'
sudo -E ./deploy/install.sh
```

Replace the placeholder before running the command. The external database must allow the application host to connect and must grant the application user permission to create and alter tables and indexes in the `infrix` database.

`SKIP_MARIADB=1` skips local MariaDB initialization only. In `fresh` mode the installer verifies that the external target database is empty before creating the current schema. In `upgrade` mode it validates the existing migration ledger and creates a database backup before applying migrations.

## 5. Create an Administrator and Access the Application

Do not invoke Django with the system Python. Use `run.sh`, which loads `/etc/infrix/infrix.env` by default:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

With the standard external HTTPS gateway, the main endpoints are:

- Application: `https://infrix.example.com/`
- Django admin: `https://infrix.example.com/admin/`
- API documentation: `https://infrix.example.com/api/docs/`

If the environment file is stored elsewhere, pass it explicitly:

```bash
sudo -u infrix env INFIX_ENV_FILE=/path/to/infrix.env ./run.sh check
```

## 6. Post-Installation Verification

Check the services and internal API endpoint:

```bash
systemctl status infrix --no-pager
systemctl status nginx --no-pager
systemctl status mariadb --no-pager

curl -fsS -H 'X-Forwarded-Proto: https' \\
  http://127.0.0.1:8001/api/v1/auth/csrf/
curl -fsS https://infrix.example.com/api/v1/auth/csrf/

journalctl -u infrix -n 100 --no-pager
cd /opt/infrix/backend
sudo -u infrix ./run.sh showmigrations assets
```

### One-Command Release Acceptance

After an installation or update, run the read-only acceptance script:

```bash
cd /opt/infrix
chmod +x deploy/verify-release.sh
sudo APP_DIR=/opt/infrix APP_USER=infrix BASE_URL=https://infrix.example.com \\
  ./deploy/verify-release.sh
```

In production mode, the script blocks on:

- `infrix` and Nginx service status.
- A required systemd `EnvironmentFile` pointing to the expected environment file.
- The Nginx `X-Forwarded-Proto` proxy contract.
- Production secrets, hosts, CSRF origins, HTTPS mode, secure cookies, HSTS, and forwarded-host policy.
- `python manage.py check --deploy` security results.
- Migration drift, unapplied migrations, preset roles, and required application tables.
- Rack U-position overlaps and out-of-range allocations.
- Frontend `index.html`, `platform-icon.png`, and API health endpoints.

The acceptance script does not replace manual verification of the firewall, Security Group, external TLS gateway, certificate chain, trusted request path, or browser behavior.

For a development deployment, use an HTTP base URL:

```bash
sudo APP_DIR=/opt/infrix APP_USER=infrix BASE_URL=http://127.0.0.1 \\
  ./deploy/verify-release.sh
```

If the API health check fails, inspect the service log:

```bash
journalctl -u infrix -f
```

Common causes include an incorrect database password, incomplete migrations, unreadable `/etc/infrix/infrix.env`, a conflicting Nginx server block, or a gateway that does not overwrite `X-Forwarded-Proto` with a single authoritative value. An HTTPS redirect loop usually means that the gateway reports the wrong protocol or that untrusted clients can reach the internal port 80 listener.

## 7. Confirm the Installation

```bash
systemctl status infrix --no-pager
curl -fsS https://infrix.example.com/api/v1/auth/csrf/
cd /opt/infrix/backend
sudo -u infrix ./run.sh showmigrations assets
```

## 8. Troubleshooting

### `ModuleNotFoundError: No module named 'django'`

Do not use the system Python. Run:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh check
```

If the virtual environment is damaged, rerun the installer with `INSTALL_MODE=upgrade`; it will rebuild an incompatible virtual environment while preserving the environment file and database. If the migration ledger belongs to a pre-baseline release, export or restore the database separately and provision a compatible migration path before upgrading.

### Database `Access denied for user 'infrix'`

Review `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `/etc/infrix/infrix.env`. Confirm that the database user is allowed to connect from the application host and has the required privileges. Restart the service after correcting the environment file:

```bash
systemctl restart infrix
```

### A Django migration is unapplied

The installer applies the current Django migration set. If an installation or upgrade was interrupted, fix the reported database or permission issue and rerun the installer with the same `INSTALL_MODE`; an upgrade automatically creates a new backup before retrying:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh migrate --noinput
sudo -u infrix ./run.sh showmigrations assets
```

### The browser still shows an older frontend

Force-refresh the browser, confirm that the build completed, and inspect the deployed artifact and service log:

```bash
ls -l /opt/infrix/frontend/dist/index.html
journalctl -u infrix -n 50 --no-pager
```

### `Production environment file not found` during installation

`INSTALL_MODE=auto` treats a service, virtual environment, database, or environment file as an installed runtime. A source tree alone does not trigger upgrade mode, so a staged or interrupted source synchronization can be reused for a fresh installation. On a real existing deployment, restore the original environment file or point the installer to it explicitly:

```bash
sudo ENV_FILE=/absolute/path/to/infrix.env INSTALL_MODE=upgrade \
  ./deploy/install.sh
```

When `ENV_FILE` is not explicitly set, the installer also reuses an existing environment-file path declared by the Infrix systemd unit. It never generates a replacement production secret for an existing runtime. If the database contains migration records from a release whose migration files are absent from this baseline package, stop and export or restore that database through a separately reviewed migration path.

### Nginx returns HTTP 400 or HTTPS redirects loop

Check for another server block declaring a conflicting `server_name _`. Then verify that the external gateway overwrites `X-Forwarded-Proto` with exactly `https` for public HTTPS requests and that only the gateway can reach the internal TCP 80 listener.

### The API is unavailable after deployment

Inspect the application status and recent logs:

```bash
systemctl status infrix --no-pager
journalctl -u infrix -n 100 --no-pager
```

Prioritize database connectivity, environment-file permissions, migration failures, and port conflicts.

## 9. Production Security Checklist

- Keep `/etc/infrix/infrix.env` at mode `640` and ownership `root:infrix`.
- Use `DJANGO_ENV=production`, `DJANGO_DEBUG=0`, a random `DJANGO_SECRET_KEY` of sufficient length, and explicit allowed hosts.
- Use MySQL/MariaDB in production. SQLite is limited to development, tests, and one-time clean-install verification.
- Define HTTPS CSRF trusted origins in the production environment file; do not hard-code real production domains in application code.
- The default HSTS value is `3600` seconds. Subdomain HSTS and preload remain disabled until every relevant subdomain has been verified to support HTTPS.
- Django enables secure session and CSRF cookies, `XFrameOptionsMiddleware`, and `X_FRAME_OPTIONS=DENY`. Nginx adds HSTS, X-Frame-Options, and `nosniff` to static frontend responses.
- Never commit or share database passwords, environment files, backups, or private keys.
- The installer keeps SELinux enabled and configures only the required Nginx-to-Gunicorn SELinux boolean. The deployment owner must verify Security Groups, firewall rules, certificates, and the real external request path.
- In local MariaDB mode, the installer keeps port 3306 on loopback and verifies that it is not exposed on a non-loopback interface. External database exposure remains the database/network administrator's responsibility.
- In external TLS gateway mode, the gateway must overwrite `X-Forwarded-Proto` with a single value and the internal port 80 listener must accept only trusted gateway traffic.
- Before production use, confirm the reviewed source commit, production preflight, either an empty fresh target or a verified upgrade backup, successful Django migrations, HTTPS behavior, firewall policy, and an application smoke test.
- `deploy/verify-release.sh` checks the production configuration and `python manage.py check --deploy`. It blocks on missing configuration, unexpected security warnings, or a non-HTTPS production acceptance URL.
