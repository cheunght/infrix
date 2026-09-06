# Infrix

Infrix is an IT asset management platform for tracking assets, infrastructure locations, maintenance, licenses, inventory, and audit history.

The backend uses Python, Django, and Django REST Framework. The frontend uses Vue 3, Vite, and Element Plus.

This repository is currently maintained as a private development baseline. It does not contain local databases, user accounts, business data, secrets, dependency directories, or build artifacts.

## Features

- Authentication, preset roles, and backend capability checks.
- Asset ledger, asset details, Excel/CSV import preview, Excel export, and custom fields.
- Data centers, server rooms, racks, U-position allocation, rack visualization, and capacity statistics.
- Device categories, vendors, device types, tags, and custom-field management.
- Fault registration, repair workflows, and repair-record export.
- Software license management.
- Inventory tasks, historical inventory records, and result export.
- Spare-part definitions, multi-location stock, and stock transactions.
- Audit logs, organization-level administrator permissions, and application-level system reset tools.
- Rocky Linux 9 deployment with MySQL/MariaDB, Gunicorn, and Nginx.

## Technology Stack

- Backend: Python 3.10+, Django, Django REST Framework, and Django REST Framework Spectacular.
- Frontend: Node.js 18+, Vue 3, TypeScript, Vite, and Element Plus.
- Development database: SQLite.
- Production database: MySQL or MariaDB through Django's MySQL backend.
- Production runtime: Gunicorn behind Nginx and an external HTTPS gateway.

## Deployment Support Policy

### Official Automatic Installation

The official automatic installation path supports Rocky Linux 9.x only and uses `deploy/install.sh`. The installer validates `/etc/os-release` and accepts `ID=rocky` with `VERSION_ID=9`, `9.x`, or `9.<minor>`.

Other Linux environments are not automatically supported by `deploy/install.sh`. The installer stops with a clear message directing administrators to the manual deployment guide. This is an automatic-installer boundary, not a statement that the application cannot run elsewhere.

### Manual Deployment

Manual deployment is distribution-agnostic at the application-requirements level. Administrators may use any Linux environment that satisfies the documented runtime, database, filesystem, networking, reverse-proxy, process-management, and production-security requirements. See [docs/MANUAL_DEPLOYMENT.md](docs/MANUAL_DEPLOYMENT.md).

The repository provides a reference production stack based on Python, MariaDB or compatible MySQL, Gunicorn, Nginx, and systemd. Equivalent components may be used by experienced administrators when they provide the same behavior, but they are not represented as tested automatic-installation integrations.

## Local Development

Install Python 3.10 or newer, Node.js 18 or newer, and npm.

### Backend

The default development configuration uses SQLite. SQLite is supported only for local development, tests, and clean-install verification; production requires an explicit MySQL/MariaDB configuration and never falls back to SQLite.

```bash
cd backend
./setup.sh
./run.sh createsuperuser
./run.sh runserver
```

`setup.sh` creates `backend/.venv`, installs the version-constrained Python requirements, applies migrations, and initializes the application data. Use the project wrapper instead of the system Python when running Django commands.

`run.sh` loads `/etc/infrix/infrix.env` by default when that file exists. For a different environment file, set `INFIX_ENV_FILE` explicitly:

```bash
INFIX_ENV_FILE=/path/to/infrix.env ./run.sh check
```

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

The frontend sends API requests to `/api/v1` by default. Set `VITE_API_BASE` when the local API is served from another base URL.

Production checks and build:

```bash
npm run typecheck
npm run build
```

The UI regression, i18n, branding, and release-gate tools are maintained in the private development workspace and are not included in the public source or user release.

The local API documentation is available at <http://127.0.0.1:8000/api/docs/>.

## Configuration and Security

Use [backend/.env.example](backend/.env.example) as a development template. Keep real environment files outside the repository and replace every example secret.

Production must define all of the following in `/etc/infrix/infrix.env` or another controlled secret-management path:

```dotenv
DJANGO_ENV=production
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<random secret of at least 50 characters>
DJANGO_ALLOWED_HOSTS=infrix.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://infrix.example.com
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
DB_HOST=db.example.internal
DB_PORT=3306
INFRIX_CONFIG_ENCRYPTION_KEY=<base64 Fernet key for database-managed LDAP secrets>
```

Production rejects missing or placeholder secrets, wildcard hosts, non-HTTPS CSRF origins, insecure cookies, invalid proxy settings, SQLite, unknown database engines, and incomplete MySQL settings. The Rocky local-MariaDB path keeps port 3306 loopback-only. Fresh installation requires an empty target database; a target directory containing only synchronized source files may be reused. An existing Infrix installation is upgraded in place from the baseline migration set: the environment file and business data are preserved, a database backup is created before migration, and unapplied Django migrations are applied. Databases from releases whose migration files are no longer present are rejected instead of being modified.

Do not commit `.env` files, SQLite databases, SQL dumps, certificates, private keys, logs, virtual environments, `node_modules`, or frontend build output. Use least-privilege database credentials and maintain a tested backup and restore procedure.

LDAP / Active Directory is configured by a system administrator from
Organization & Permissions → LDAP / AD. `INFRIX_CONFIG_ENCRYPTION_KEY` must be
present before saving a bind password; it is used only for authenticated
encryption at rest. Fresh installations start with LDAP disabled and do not
require any LDAP runtime environment variables.

## Rocky Linux 9 Deployment

See [docs/INSTALL_VM.md](docs/INSTALL_VM.md) for the complete Rocky Linux 9 installation, upgrade, verification, and troubleshooting guide.

This is the official automatic-installation guide. `deploy/install.sh` is intentionally not a universal Linux installer and does not advertise automatic support for other distributions.

The standard production deployment path assumes an external HTTPS gateway terminates TLS. Nginx listens on private TCP port 80 and forwards the gateway-controlled `X-Forwarded-Proto` value to Django. TCP port 80 must not be exposed directly to untrusted clients.

At minimum, provide the following values before a fresh production installation:

```bash
export SERVER_NAME=infrix.example.com
export DJANGO_ENV=production
export DJANGO_ALLOWED_HOSTS='infrix.example.com'
export DJANGO_CSRF_TRUSTED_ORIGINS='https://infrix.example.com'
export DJANGO_HTTPS_MODE=proxy
export DB_ENGINE=mysql
export DB_NAME=infrix
export DB_USER=infrix
export DB_HOST=127.0.0.1
export DB_PASSWORD='<database-password>'
export DB_PORT=3306
sudo -E ./deploy/install.sh
```

Replace `<database-password>` with a real password before execution.

`INSTALL_MODE=auto` is the default: it selects a fresh installation when no Infrix runtime is present and an in-place upgrade when an Infrix service, virtual environment, database, or environment file is present. A synchronized source tree by itself is not treated as an installed runtime, so interrupted or staged fresh-install source directories can be reused. Set `INSTALL_MODE=upgrade` explicitly when updating an existing deployment; the installer preserves the existing environment file and creates a restricted database backup before migrations.

On a fresh production install, the installer may generate `DJANGO_SECRET_KEY` after it confirms that the target MySQL database is empty. During an upgrade, `DJANGO_SECRET_KEY` must already exist in the environment file and is never regenerated.

Before installing a release, the release owner runs the private release gate against a clean public checkout:

```bash
INFRIX_REPO_ROOT=/path/to/infrix-source \
INFRIX_PRIVATE_ROOT=/path/to/infrix-private \
/path/to/infrix-private/scripts/check-release.sh
```

The private release gate prints the candidate commit SHA and checks the working tree, production configuration, Django checks, migration drift, frontend regressions, type checking, and the production build. The production server only needs the public source and the deployment verification tools.

## Remote Source Synchronization

When updating a Rocky Linux VM from macOS or another development host:

```bash
./deploy-to-remote.sh <ssh-target> [remote-source-dir]
```

Examples:

```bash
./deploy-to-remote.sh root@rocky-host
./deploy-to-remote.sh deploy@server-host /opt/infrix-src
```

The helper synchronizes source code only. It excludes Git metadata, databases, virtual environments, dependency directories, static files, frontend dependencies, and build output, then invokes the installer on the remote host.

## Repository and Public Release Notes

This project is currently a private development baseline. Before publishing it to a public GitHub repository, review the license, secret-scanning policy, issue and security-reporting process, branch protection, and release workflow.
