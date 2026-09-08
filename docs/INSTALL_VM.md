# Rocky Linux 9 Automatic Installation and Upgrade

This guide is the primary English guide for installing and upgrading Infrix on
Rocky Linux 9.x. For the Chinese guide, see
[Rocky Linux 9 中文安装文档](DEPLOYMENT.zh-CN.md). For the installer's detailed
retry and packaging behavior, see [Installer Workflow](INSTALLER_WORKFLOW.md).

The automatic installer manages the application runtime, the selected
database, frontend assets, systemd units, and the Nginx entry point. Use the
[manual deployment guide](MANUAL_DEPLOYMENT.md) when another Linux distribution
or a custom service layout is required.

## 1. Choose a deployment path

| Situation | Recommended path |
| --- | --- |
| Rocky Linux 9.x, new host | Run `deploy/install.sh` and use the wizard. |
| Rocky Linux 9.x, existing Infrix | Rerun the installer for an in-place upgrade. |
| Release package | Extract the package and run the installer; Node.js is not needed on the target. |
| Other Linux distribution | Follow [Manual Deployment](MANUAL_DEPLOYMENT.md). |

The reference runtime is:

```text
Client → HTTPS gateway or local Nginx TLS → Nginx → Gunicorn:127.0.0.1:8001 → MariaDB
                                      └→ frontend/dist
```

An external gateway may terminate public TLS and forward to private Nginx on
port 80. A host without a gateway may use the wizard's self-signed certificate
or an existing certificate and let local Nginx listen on port 443. Do not
expose Gunicorn or MariaDB to untrusted clients.

The `v0.1.0` source tree is a clean fresh-install migration baseline. A
pre-release development database created from older migration history must be
recreated for that baseline; never apply this rule to production data. Future
`v0.1.x` production upgrades must ship explicit incremental migrations.

## 2. Before you begin

The target host needs:

- Rocky Linux 9.x and root access or a sudo-capable account.
- Access to Rocky package repositories and Python package sources.
- At least 2 GiB free in `/var/tmp` for the installer preparation area.
- A synchronized system clock, working DNS, and the required network routes.
- Unused or intentionally managed ports 80, 443, and 8001.

For a source installation, keep the complete tree containing
`backend/manage.py`, `backend/requirements.txt`, `frontend/package.json`, and
`frontend/package-lock.json`. The installer can install Python 3.10+ and
Node.js 18+ from Rocky repositories. The target of a release package still
needs Python and system packages, but does not need Node.js or npm.

Choose the database and HTTPS mode before starting:

- Local MariaDB: allow the installer to install and manage MariaDB, create the
  dedicated database account, and bind port 3306 to loopback.
- External MariaDB: create the database and account first, then set
  `SKIP_MARIADB=1` in the production environment file.
- Local TLS: use a self-signed certificate for an internal deployment or bring
  an existing certificate and private key.
- Gateway TLS: configure the trusted gateway before the final HTTPS check and
  make it overwrite `X-Forwarded-Proto` with one authoritative value.

The installer warns when time synchronization is not active. Correct the host
clock before retrying if package or certificate validation fails.

## 3. Obtain the source or release package

### Source tree

Clone or copy the repository to a staging directory:

```bash
dnf install -y git
git clone <repository-url> /tmp/infrix-src
cd /tmp/infrix-src
```

### Prebuilt release package

Build packages on a development machine as described in
[Installer Workflow](INSTALLER_WORKFLOW.md), then extract one on the target:

```bash
mkdir /tmp/infrix-release
tar -xzf infrix-release.tar.gz -C /tmp/infrix-release
cd /tmp/infrix-release
```

The installer verifies `frontend-release.json` and the files under
`frontend/dist`. Do not edit those files after packaging.

### Remote synchronization

From an administration workstation:

```bash
./deploy-to-remote.sh <ssh-target>
```

The default remote staging directory is `/tmp/infrix-src`. A custom directory
must be writable by the SSH account. The helper uploads source, then invokes
the installer through sudo on the remote host:

```bash
./deploy-to-remote.sh --config /etc/infrix/infrix.env <ssh-target>
./deploy-to-remote.sh --non-interactive \
  --config /etc/infrix/infrix.env <ssh-target>
```

The `--config` path is on the remote server and is never copied from the
workstation. Noninteractive mode requires passwordless sudo and a complete
environment file.

## 4. First installation

From the source or extracted package directory, run:

```bash
sudo bash deploy/install.sh
```

When no Infrix runtime exists and no `DJANGO_ENV` is already supplied, the
wizard asks for the access IP/hostname, database mode, and HTTPS mode. It then:

1. Generates the Django and Fernet secrets that are needed.
2. Generates a local database password when local MariaDB is selected.
3. Writes `/etc/infrix/infrix.env` with owner `root:infrix` and mode `640`.
4. Confirms that the new database is empty before applying migrations.
5. Installs the runtime, initializes system data, configures systemd/Nginx,
   and performs the HTTPS acceptance check.

In an interactive terminal, the installer checks for an active superuser and
opens the administrator prompt when one is missing. In a noninteractive run,
create one after the service is ready:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

The completed environment file, database, private key, and backups must remain
outside the source tree. Never paste the environment file into logs or shared
terminals.

## 5. Configuration, keys, and preflight

Use [`deploy/infrix.env.example`](../deploy/infrix.env.example) as the only
field reference. For a preconfigured or noninteractive installation, pass an
absolute environment-file path:

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env
```

Production requires explicit `DJANGO_ENV=production`, non-debug settings,
allowed hosts, HTTPS CSRF origins, and MySQL connection values. When LDAP/AD
or another protected configuration feature is used, keep a stable
`INFRIX_CONFIG_ENCRYPTION_KEY`; it encrypts secrets stored in the database.
Generate it once and back it up with the environment file and database:

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

Do not regenerate the key during an upgrade. A missing Django secret may be
generated only for a confirmed empty fresh-install database; an existing
production installation must keep its current secret.

Run the read-only configuration check with:

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

This command validates the environment file and does not modify packages,
services, Nginx, or the database. Machine checks such as disk space, port
conflicts, and certificate readability run automatically during a normal
installation.

## 6. Database setup

### Local MariaDB

The wizard's local database option installs and starts MariaDB, creates the
`infrix` database and dedicated application user, and verifies that MariaDB
only listens on loopback. No public database port is required.

### External MariaDB

Create an empty `utf8mb4` database and a dedicated account on the database
server. Grant the account the table and index permissions required by Django
migrations, restrict its network source, and configure the application host:

```dotenv
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<database-password>
DB_HOST=<database-host>
DB_PORT=3306
SKIP_MARIADB=1
```

Then run the installer with the completed file. The installer checks the
connection and applies migrations; it does not provision the external server.
Never expose port 3306 to untrusted clients.

## 7. HTTPS and access modes

The installer supports three HTTPS choices:

| Installer mode | Behavior |
| --- | --- |
| `TLS_MODE=self-signed` | Generate a local certificate when no pair exists; Nginx serves HTTPS on 443 and redirects port 80. |
| `TLS_MODE=certificate` | Use the supplied `TLS_CERT_FILE` and `TLS_KEY_FILE` pair for local Nginx TLS. |
| `TLS_MODE=gateway` | Do not terminate TLS locally; a trusted external gateway serves HTTPS and reaches private Nginx on port 80. |

The Django setting remains `DJANGO_HTTPS_MODE=proxy` for the supplied Nginx
deployment. In gateway mode, only the trusted gateway may set the forwarded
protocol header. In self-signed mode, add the generated certificate to the
client trust store or pass it as a CA during diagnosis; browsers will otherwise
show a trust warning.

The installer runs a real HTTPS check after startup. Run it later with:

```bash
bash deploy/doctor.sh https://infrix.example.com
```

For a self-signed certificate:

```bash
bash deploy/doctor.sh \
  https://192.0.2.10 \
  /etc/pki/tls/certs/infrix.crt
```

The check requires TLS, HTTP 200, valid SPA content for `/` and `/assets`, a
valid CSRF token response, and a reachable branding endpoint. A 301, 400,
connection refusal, certificate failure, or HTML error response is not
accepted as healthy.

## 8. Upgrade, retry, and backup behavior

For an existing installation, the default `INSTALL_MODE=auto` detects the
runtime and performs an in-place upgrade. To make the choice explicit:

```bash
sudo env INSTALL_MODE=upgrade bash deploy/install.sh
```

Upgrades preserve `/etc/infrix/infrix.env` and business data. Before stopping
the active application, the installer checks migration compatibility, creates a
restricted database backup in `/var/backups/infrix`, downloads Python wheels,
and prepares the frontend. A pre-stop preparation failure leaves the old
application running.

Fresh installations record `configured`, `database-ready`, and `complete` in
`${ENV_FILE}.install-state`. If a fresh installation is interrupted, rerun the
same command with the same source, environment path, and application directory.
The installer reuses the saved secrets and rejects a changed configuration or
destination rather than risking the wrong database.

Nginx configuration is backed up before replacement. If `nginx -t` fails, the
previous configuration is restored and Nginx is not reloaded. A database
migration is not automatically rolled back; use the retained database backup
and normal recovery procedure after a live mutation failure. Failed preparation
directories under `/var/tmp/infrix-prepare.*` are retained for diagnosis.

## 9. First login, health checks, and daily operations

The standard endpoints are:

- Application: `https://<hostname>/`
- Administration: `https://<hostname>/admin/`
- API documentation: `https://<hostname>/api/docs/`

After login, complete any requested password change, create organizations and
locations, and then configure assets and permissions. LDAP/AD and SMTP are
optional integrations; configure them from the administration UI only after
the base application is healthy. Keep the Fernet key available before saving
LDAP or other protected passwords.

Check the deployment with:

```bash
sudo systemctl is-active infrix nginx mariadb
sudo nginx -t
bash deploy/doctor.sh https://<hostname>
sudo journalctl -u infrix -n 100 --no-pager
```

Back up the database and `/etc/infrix/infrix.env`, including
`DJANGO_SECRET_KEY` and `INFRIX_CONFIG_ENCRYPTION_KEY`. Keep database dumps,
certificates, private keys, and logs protected according to the site's recovery
policy.

## 10. Troubleshooting and security checklist

### The installer says `DJANGO_ENV` is missing

Run the interactive wizard from a terminal, or provide a complete production
environment file with `--config`. Do not put a completed secret file in the
source tree. Check it without printing its contents:

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

### The browser reports HTTP 400, connection refused, or a failed session

Check `infrix` and Nginx status and logs, confirm the address is in
`DJANGO_ALLOWED_HOSTS`, and run `doctor.sh` against the exact HTTPS URL. For a
gateway, confirm that it reaches private Nginx and sets one trusted
`X-Forwarded-Proto` value. For local TLS, confirm the certificate name matches
the IP/hostname and that the client trusts the certificate.

### The database or migration check fails

Verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, grants, and
network policy. A fresh database must be empty; an upgrade must contain every
already-applied migration file and have a readable pre-upgrade backup. Never
delete migration records or applied migration files to bypass an error.

### Production safety checklist

- Use `DJANGO_ENV=production`, `DJANGO_DEBUG=0`, explicit hosts, and HTTPS.
- Keep the environment file at `root:infrix` mode `640`.
- Keep Gunicorn and local MariaDB on protected interfaces.
- Keep SELinux enabled and allow only the required Nginx-to-Gunicorn policy.
- Restrict database, certificate, private-key, log, and backup access.
- Maintain tested backups of the database and environment file.
