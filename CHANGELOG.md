# Changelog

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
