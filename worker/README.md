# Planning Cloudflare

Le site est prêt pour un mode hybride :
- s'il trouve `/api/planning`, il utilise Cloudflare
- sinon il repasse temporairement en mode local navigateur

## Fichiers
- `worker/planning-api-worker.mjs`
- `worker/wrangler.example.toml`
- `pages/planning-lives.html`
- `pages/planning-lives-admin.html`

## Variables Cloudflare
- `ADMIN_EMAIL` (var)
- `ADMIN_PASSWORD` (secret)
- `SESSION_SECRET` (secret)
- `PLANNING_KV` (binding KV)

## Routes attendues
- `GET /api/planning`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/planning`
- `POST /api/admin/planning`
- `PUT /api/admin/planning`
- `DELETE /api/admin/planning?id=...`
- `DELETE /api/admin/planning?all=1`

## Déploiement
1. Créer un namespace KV pour le planning.
2. Déployer le Worker.
3. Ajouter le binding `PLANNING_KV`.
4. Ajouter `ADMIN_PASSWORD` et `SESSION_SECRET` en secret.
5. Mettre une route Cloudflare sur `www.neganlab.be/api/*`.
6. Optionnel : ajouter aussi `neganlab.be/api/*`.

## Important
Sans route `/api/*`, le site continue de fonctionner en mode local.
Dès que le Worker est branché, les événements sont partagés entre appareils.
