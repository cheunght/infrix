# Infrix Installer Workflow

This document explains the behavior of the Infrix installer beyond the
command examples in the [Rocky Linux installation guide](INSTALL_VM.md). For
the Chinese version, see [安装流程说明](INSTALLER_WORKFLOW.zh-CN.md).

## First installation

The automatic installer supports Rocky Linux 9.x. Run it from the project root
or from an extracted release package:

```bash
sudo bash deploy/install.sh
```

When the target is a fresh installation and no `DJANGO_ENV` is supplied, the
interactive wizard asks for:

1. The public IP address or hostname, without a protocol or port.
2. A local MariaDB instance or an existing external MariaDB server.
3. An existing certificate, a locally generated self-signed certificate, or
   an external HTTPS gateway.

The wizard saves the resulting configuration to
`/etc/infrix/infrix.env` with `root:infrix` ownership and mode `640`. It
generates a Django secret, a stable Fernet key, and a local database password
when those values are needed. The installer never replaces an existing
environment file during an upgrade.

An interactive run checks for an active administrator after the services start
and opens the `createsuperuser` prompt when one does not exist. A noninteractive
run prints the command to create one:

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

The first installation requires an empty target database. The installer also
checks the machine before package installation: time synchronization is
reported, `/var/tmp` must have at least 2 GiB available, and conflicting
listeners on ports 80, 443, or 8001 are rejected.

## Configuration and noninteractive use

Use the repository template as the field reference:
[`deploy/infrix.env.example`](../deploy/infrix.env.example). Keep the completed
file outside the source tree. A custom file must be selected with an absolute
path:

```bash
sudo bash deploy/install.sh --config /etc/infrix/infrix.env
```

For a noninteractive first installation, provide a complete production file
before running the installer. It must define the production Django settings,
explicit hosts and HTTPS CSRF origins, and MySQL connection values. Include
`INFRIX_CONFIG_ENCRYPTION_KEY` when LDAP/AD or another protected configuration
feature will be used. The installer can generate missing secrets only for a
confirmed empty fresh-install database; do not rely on that behavior for an
upgrade.

`INFRIX_CONFIG_ENCRYPTION_KEY` is a URL-safe Fernet key for encrypting stored
LDAP/AD and other protected configuration secrets. Generate it once, store it
with the environment file and database backup, and never replace it casually:

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

The read-only configuration check is:

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

`--preflight` validates the environment file only. It does not install
packages, change services, write the database, or change Nginx. The broader
machine readiness checks run automatically as part of a normal installation.

## Remote deployment

The remote helper uploads the project source to a user-writable staging
directory, then invokes the installer with `sudo` on the remote host:

```bash
./deploy-to-remote.sh <ssh-target>
./deploy-to-remote.sh --config /etc/infrix/infrix.env <ssh-target>
./deploy-to-remote.sh --non-interactive \
  --config /etc/infrix/infrix.env <ssh-target>
```

The `--config` path is on the remote server; it is not copied from the local
machine. Interactive mode allocates a terminal for the wizard and password
prompts. Noninteractive mode requires passwordless sudo and a complete remote
environment file. The default staging directory is `/tmp/infrix-src`.

## Retry and upgrade behavior

During a fresh install, the installer records the phases `configured`,
`database-ready`, and `complete` in `${ENV_FILE}.install-state`. The state file
contains a fingerprint of the environment file and `APP_DIR`. If the process
is interrupted, rerun the same command with the same source and configuration.
The installer reuses the generated secrets and only resumes a matching state.
If the environment file or application destination changed, it stops instead
of risking the wrong database.

For an existing installation, `INSTALL_MODE=auto` detects the runtime and
performs an in-place upgrade. `INSTALL_MODE=upgrade` can be used explicitly:

```bash
sudo env INSTALL_MODE=upgrade bash deploy/install.sh
```

An upgrade preserves the environment file and business data. It validates that
recorded migrations are present in the new source, creates a restricted
database backup under `/var/backups/infrix`, and prepares Python wheels and the
frontend before stopping the active application. If preparation fails, the
old application remains available. After the live files or database have been
changed, recovery is a normal backup-based operational task; the installer does
not automatically roll back a database migration.

The current Nginx site configuration is copied to `/var/backups/infrix` before
replacement. If `nginx -t` rejects the new configuration, the previous file is
restored and Nginx is not reloaded. Failed preparation directories under
`/var/tmp/infrix-prepare.*` are retained for diagnosis and may be removed by an
administrator after the incident is understood.

## Release packages

Build a release package on a development machine with Git, Python 3, Node.js,
and npm:

```bash
python3 scripts/release-package.py \
  --output /tmp/infrix-release.tar.gz
```

The builder runs `npm ci` and the frontend build, then packages the source,
`frontend/dist`, and a checksum manifest. The target installer verifies the
manifest and skips Node.js installation and frontend compilation:

```bash
mkdir /tmp/infrix-release
tar -xzf /tmp/infrix-release.tar.gz -C /tmp/infrix-release
cd /tmp/infrix-release
sudo bash deploy/install.sh
```

This is not a fully offline package: Rocky packages and Python dependencies
still need to be available from the configured repositories or package cache.
Do not alter files under `frontend/dist` after building; the checksum check is
intended to catch incomplete or tampered packages.

## HTTPS acceptance and diagnosis

The installer validates the actual HTTPS origin after starting the services.
The check requires TLS, HTTP 200, a valid SPA document for `/` and `/assets`,
and valid response content for the CSRF and branding endpoints. A redirect,
certificate error, connection refusal, or an HTML error page returned by the
CSRF endpoint is a failure.

Run the same read-only diagnosis later with:

```bash
bash deploy/doctor.sh https://infrix.example.com
```

For a self-signed certificate, pass the certificate as the local CA file:

```bash
bash deploy/doctor.sh \
  https://192.0.2.10 \
  /etc/pki/tls/certs/infrix.crt
```

Use `TLS_MODE=self-signed` for local Nginx TLS, `TLS_MODE=certificate` for an
existing certificate/key pair, and `TLS_MODE=gateway` when a trusted external
gateway terminates TLS. The current Nginx deployment keeps
`DJANGO_HTTPS_MODE=proxy`; in gateway mode the gateway must overwrite
`X-Forwarded-Proto` with one authoritative value.

## Operator checklist

After a successful run, verify:

- `systemctl is-active infrix nginx mariadb` reports the services that apply.
- `nginx -t` succeeds and the configured HTTPS URL passes `doctor.sh`.
- `/etc/infrix/infrix.env` remains `root:infrix` with mode `640`.
- The administrator can log in and complete any requested password change.
- The database backup and the environment file, including the Fernet key, are
  stored according to the site's recovery policy.

For detailed database, LDAP, SMTP, reverse-proxy, backup, and security
procedures, continue with the language-specific installation guide or the
[manual deployment guide](MANUAL_DEPLOYMENT.md).
