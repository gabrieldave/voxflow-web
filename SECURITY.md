# Security — VoxFlow Web 2.3.0

- Headers: X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, HSTS, poweredByHeader disabled (Node sin X-Powered-By).
- Docker: read_only, tmpfs /tmp + /dev/shm noexec,nosuid, cap_drop ALL, no-new-privileges, usuario node.
- Secretos solo por entorno Coolify (DATABASE_URL, VOXFLOW_ED25519_PRIVATE_KEY, VOXFLOW_ED25519_PUBLIC_KEY, STRIPE_WEBHOOK_SECRET). Sin secretos en git.
- Licencias Ed25519 canónicas VFS1 / VFS1R verificadas con crypto nativo.
- Rate limiting por IP en checkout/activate/trial.
- `npm audit --omit=dev --audit-level=high` debe estar limpio.
