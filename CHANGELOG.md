# Changelog

## 0.3.0 — 2026-09-28

Core asset workflow and deployment-safety release.

### Included

- Added paginated, asset-scoped history and the asset disposal workflow.
- Added People and Department import templates, previews, and bounded commits, including leading-zero identifier preservation.
- Centralized physical-location operations and tightened reference-data and system-settings safeguards.
- Protected persistent media during source synchronization and moved media/backup safety checks ahead of installation mutations, including read-only preflight.
- Allowed upgrades with already-installed system packages to proceed without refreshing package repositories.
- Removed increment/decrement buttons from the LDAP/AD server port fields.

### Verification

- Backend tests, frontend tests, type checking, and production build pass.
- Installer and persistent-media regression checks pass.

## 0.2.0 — 2026-09-17

Production correctness and security closeout for the deployment baseline.

### Included

- Hardened trusted-proxy handling and forwarded-client-IP resolution.
- Added CSRF protection and persistent throttling for API and admin authentication, including admin 2FA support and replay protection.
- Fixed concurrent asset, rack, room, inventory, and network configuration updates with deterministic physical-location locking.
- Made backup media restoration transactional with staging and rollback, and made system reset dependency-safe.
- Added validation preventing required custom fields from being hidden.
- Fixed asset-model, rack-capacity, authentication-CSRF, and inventory configuration flows in the frontend.
- Updated production environment templates and deployment documentation for trusted proxy configuration.

### Verification

- Django system checks and backend tests pass.
- Frontend type checking and production build pass.
- Installer regression checks pass.
- MariaDB migration, serializer, concurrency, and reset validation pass against the production validation host.
