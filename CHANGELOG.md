# Changelog

## 0.1.0 — 2026-09-08

First `infrix` release candidate. This entry describes the implementation currently in the repository.

### Included

- Asset, spare-part, license, facility, department, repair, fault, inventory, and responsibility management.
- Local authentication with role-based capabilities, password-change enforcement, CSRF protection, rate limiting, audit logging, and safe operational diagnostics.
- LDAP/AD configuration, connectivity diagnostics, directory identity mapping, and just-in-time local-user provisioning.
- System administration for localization, timezone, date format, currency, maintenance mode, and runtime settings.
- Configurable `infrix` branding with validated image uploads and built-in fallback assets.
- SMTP test delivery and opt-in daily notification digest delivery with durable idempotency and retry state.
- Rocky Linux 9 / MariaDB / Gunicorn / Nginx deployment guidance, upgrade safeguards, and backup procedures.

### Verification note

The release candidate is covered by the repository’s automated backend and frontend checks, plus a fresh SQLite migration, bootstrap, authentication, and API smoke test. Real Microsoft AD, SMTP delivery, MariaDB, and production reverse-proxy verification remain environment-specific checks.

### Not included

This release does not introduce a backup/restore product feature, 2FA, SSO/SAML, workflow/procurement modules, or other feature-freeze additions.
