# Backend notifications — bêta

Ce dossier prépare le remplacement de Google Sheet / Apps Script par Cloudflare
Workers + D1. Les trois pages bêta l’utilisent et une application OneSignal
séparée permet les essais de push sans toucher aux abonnés de production.

## Garanties de la phase bêta

- `PUSH_ENABLED` est activé uniquement avec l’application et la clé OneSignal bêta.
- Aucune clé OneSignal ne doit être ajoutée au dépôt.
- L’API publique conserve les neuf champs attendus, avec `expire: ""`.
- L’ID est généré atomiquement par SQLite/D1.
- La date et l’heure sont générées côté serveur en fuseau `Europe/Paris`.
- Les routes d’administration exigent le secret Worker `ADMIN_TOKEN`.

## Routes

- `GET /api/health`
- `GET /api/notifications`
- `GET /api/admin/notifications`
- `POST /api/admin/notifications`
- `PATCH /api/admin/notifications/:id`

## Déploiement ultérieur

Le déploiement nécessite un compte Cloudflare et ne doit être exécuté qu’après
validation. Le `database_id` factice de `wrangler.toml` devra être remplacé par
celui de la base bêta au moment du déploiement.

Les secrets `ADMIN_TOKEN` et `ONESIGNAL_REST_API_KEY` sont créés avec Wrangler
et ne doivent jamais être écrits dans un fichier versionné.

## Test local

```bash
npx wrangler d1 execute ecurie-notifications-beta --local --file schema.sql
npx wrangler dev
```

Copier `.dev.vars.example` en `.dev.vars` et choisir un jeton local avant le
second appel. Ce fichier est ignoré par Git.

## Reprendre les données Apps Script

Sauvegarder la réponse JSON actuelle, puis produire un fichier SQL D1 :

```bash
node scripts/json-to-seed.mjs export-appscript.json > /tmp/notifications-seed.sql
npx wrangler d1 execute ecurie-notifications-beta --local --file /tmp/notifications-seed.sql
```

L’import conserve les IDs historiques afin de préserver les états lus déjà
enregistrés sur les téléphones. Les nouveaux IDs repartent automatiquement du
plus grand ID importé.
