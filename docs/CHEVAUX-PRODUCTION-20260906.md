# Publication CHEVAUX — production, 6 septembre 2026

## Références de retour arrière

Les deux dépôts distants conservent le tag `before-chevaux-prod-20260906` :
- PWA Damiensiri/push2 : 9914712.
- Backstage Damiensiri/ecurie : ee6452f.
- Worker avant bascule : d2a2f74d-54e3-45da-8a0a-34c60be47808.
- Mailer production : déploiement existant, version 1 avant, version 2 avec CHEVAUX. Historique Apps Script conservé.

Sauvegarde privée hors dépôts publics : /Users/damiensiri/Documents/Codex/2026-09-06/on-x20/production-rollback-20260906/ (SQL, snapshots et archives des interfaces).

Le retour aux interfaces précédentes se fait en restaurant les fichiers suivis du tag puis en publiant un nouveau commit ; ne pas réécrire l’historique Git. Conserver le Worker compatible avec le schéma enrichi. L’API d’ajout au planning accepte aussi l’ancien formulaire par nom pour ce retour arrière. Ne jamais remettre l’ancien Worker brut contre la nouvelle base : la colonne `active` est désormais calculée. Le dossier privé contient aussi `worker-compatible-rollback.mjs` et `wrangler-rollback.toml` : code précédent adapté à la colonne `status`, utilisable sans supprimer les tables sanitaires. Ce rollback retire les fonctions CHEVAUX du Worker et son Cron quotidien tout en conservant les données. Ne le lancer que si le retour arrière est demandé.

Un retour complet au schéma précédent demande un export récent et une migration inverse adaptée, afin de garder toutes les écritures postérieures à la bascule. La sauvegarde initiale ne doit pas écraser les données récentes.

## Préservation

Aucune copie de données bêta vers la production. Répétition des migrations 0023 à 0027 sur une copie de l’export production : toutes les valeurs des colonnes existantes sont strictement identiques après migration ; clés étrangères valides.

Instantané initial : 15 chevaux, 78 rattachements hebdomadaires, 270 activités, 227 réservations et 15 demandes. Semaine du 7 septembre : 9 chevaux, 33 activités. Comparaison finale des exports distants avant/après validée : toutes les colonnes préexistantes de ces cinq tables sont strictement identiques, et aucune erreur de clé étrangère. Les 9 chevaux et 33 activités de la semaine du 7 septembre sont conservés.

## Réglages

Photos : stockage production, liens privés configurables, durée initiale 600 secondes. Rappels : 07:00 UTC, offsets 7 et 0 jours, lot maximum 50. Destinataires : propriétaires actuels. Aucun propriétaire ou soin de démonstration transféré de la bêta.

Les réglages existants de production (domaines, OneSignal client et administration, horaires, mailer, D1, R2 et realtime) sont conservés. Les activités personnelles sont exclues du planning Backstage et tablette ; les modifications administratives de ces activités sont refusées.

## Publication vérifiée

Migrations 0023 à 0027 appliquées sur D1 production le 6 septembre. Worker publié : 4ccab1bf-1125-481c-a729-78d06d4f3a9d ; API santé HTTP 200, suspension des écritures levée. Deux secrets R2 chiffrés installés, clé limitée à la lecture du bucket production. Tests préparatoires : 46/46 Worker/PWA et 12/12 Backstage, validation syntaxique et déploiement à blanc réussis. Exports finaux privés : cutover-before.sql et cutover-after.sql, comparaison : cutover-comparison.json. Aucun nouvel e-mail de test envoyé en production.
