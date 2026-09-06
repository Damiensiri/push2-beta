# CHEVAUX — Étape 3, bêta — 6 septembre 2026

## Résultat

Une réservation paddock peut lier zéro, un ou plusieurs chevaux actifs du compte qui réserve. La sélection complète est vérifiée par une seule requête SQL. Un cheval non autorisé fait refuser toute l'opération. Les liens sont enregistrés dans la transaction de réservation, avec les verrous de créneau.

Les réservations restent exclusivement dans `paddock_reservations`. Le planning client et le planning Backstage les agrègent par `UNION ALL`, sans copie dans `planning_tasks`. Les réponses de planning exposent des événements génériques. L'ancien champ `tasks` reste disponible pour les commandes de gestion et la compatibilité des interfaces. Une réservation est en lecture seule dans le planning ; sa modification passe par l'écran paddocks. L'écran tablette affiche également ces événements sans bouton de validation de tâche.

La modification conserve l'identifiant de réservation et change date, heure, paddock, durée et chevaux dans une transaction. Un numéro de version empêche l'écrasement par un écran obsolète. L'annulation supprime les liens par cascade. Archiver un cheval ou le retirer de la vue hebdomadaire ne supprime pas son événement.

## Migration réellement appliquée

`notifications-backend/migrations/0025_paddock_booking_horses.sql`, sur **ecurie-notifications-beta** uniquement :

- création de `paddock_booking_horses(booking_id, horse_id)`, clé primaire composée ;
- réservation en `ON DELETE CASCADE`, cheval en `ON DELETE RESTRICT` ;
- index `(horse_id, booking_id)` pour le planning d'un cheval ;
- ajout de `paddock_reservations.version`, entier obligatoire, valeur initiale 1.

Sauvegarde D1 préalable : `/tmp/step3-beta-backup-20260906.sql` (données privées, hors Git).
Contrôle distant : `PRAGMA foreign_key_check` sans anomalie ; 10 réservations préexistantes conservées, version 1 ; aucun lien inventé pour les réservations historiques.
Worker déployé : `1711ee64-d61d-4bab-bb17-f59286f3f9c7`.

## Fichiers principaux

Dans push2-beta :

- `notifications-backend/src/paddock-horses.js` : validation groupée, listes de choix, insertion des liens ;
- `notifications-backend/src/worker.js` : routes de réservation, modification transactionnelle, agrégation Backstage ;
- `notifications-backend/src/horses.js` : agrégation du planning client ;
- `planningpaddock.html`, `mesreservations.html`, `assets/js/paddock-horses.js` : sélection et modification ;
- `assets/js/pages/mes-chevaux.js`, `mes-chevaux.html`, `planning.html` : événements en lecture seule ;
- ressources de version PWA : `20260906-6`, sans suppression des sessions ;
- `notifications-backend/test/horses.test.js`, `test/pwa-horses.test.js`.

Dans backstage-beta : `paddocks.html`, `planning.html`, `assets/js/planning.js`, `assets/js/paddock-horses.js`.

## Vérifications

- `npm test` Worker/PWA : **45 tests réussis**, aucun échec.
- `npm test` Backstage : **15 tests réussis**, aucun échec.
- Tests D1/Miniflare : sélection multiple, sélection vide, propriétaire incorrect, identifiant absent, doublons, types invalides, refus sans écriture, accès cloisonné, changement de semaine et de chevaux, version obsolète, modifications simultanées (une réussite, un conflit), libération des anciens créneaux, filtre Backstage, archivage, retrait de la vue, annulation, parcours admin et intégrité des clés étrangères.
- Assertion de performance : validation de plusieurs chevaux en **une requête**, planning Backstage en **six**.
- Vérification JS des scripts modifiés et scripts intégrés aux pages ; `git diff --check`.
- Contrôle navigateur local du vrai composant d'édition avec API simulée : présélection, ajout d'un deuxième cheval et envoi de `horseIds: [1,2]`.
- `wrangler deploy --dry-run`, migration et déploiement bêta réussis.
- Contrôles HTTP distants : planning et paddocks répondent 200 ; événements présents ; nouvelles routes sans authentification refusées en 401. Aucune réservation de test créée dans les comptes réels.

## Mesures D1

Les comptes incluent chaque instruction d'un `DB.batch`, et non seulement les allers-retours réseau. Les lectures/écritures sont les métadonnées D1, indexes compris.

Mesure distante du même endpoint `/api/admin/planning?week=2026-09-07`, trois appels avant et trois après :

| Mesure | Avant | Après |
|---|---:|---:|
| Requêtes D1 | 6 | 6 |
| Lignes lues | 15 | 16 |
| Lignes écrites | 0 | 0 |
| Durée Worker observée | 39 / 40 / 41 ms | 75 / 46 / 42 ms |

Petit échantillon sur une semaine légère sans réservation associée : ces durées ne constituent pas un benchmark de charge. Le premier appel après déploiement est plus lent. Il faut refaire une mesure avec des semaines remplies.

Budgets et observations de la fixture locale :

| Opération | Avant | Après | Lues / écrites après |
|---|---:|---:|---:|
| Fiche cheval avec événements, authentification comprise | 3 | 3 | selon événements |
| Liste des réservations client | 2 | 2 | 8 / 0 |
| Création 60 min, deux chevaux, push désactivé dans la fixture | 10* | 12 | 33 / 18 |
| Création 60 min, aucun cheval | 10* | 11 | 18 / 12 |
| Modification, deux liens remplacés par un | — | 12 | 32 / 17 |
| Annulation d'une réservation liée | 4* | 4 | 15 / 4 |

`*` Comparaison par les instructions du chemin précédent ; seules les valeurs après sont mesurées dans cette fixture. L'écran de réservation charge les chevaux en une requête supplémentaire, groupée avec son chargement existant. Les coûts d'envoi push/email peuvent augmenter les budgets des mutations distantes. Le chargement global PWA et son appel d'identité restent distincts de ces endpoints.

## Ajustements et points à surveiller

- Seule table métier nouvelle : `paddock_booking_horses`. La colonne `version` est un complément pour sécuriser les modifications simultanées.
- Choix limité aux chevaux actifs ; événements des chevaux partis/archivés conservés. Les réservations préexistantes restent sans chevaux jusqu'à leur modification explicite.
- Les créneaux saisis doivent commencer à l'heure ou à la demi-heure, en cohérence avec les verrous de réservation.
- Tester les parcours sur iPhone/PWA installée avec de vraies réservations, notamment plusieurs copropriétaires, un déplacement et une annulation.
- Le Cron paddock existant lit les dates courantes des réservations. Les rappels déjà envoyés pour une réservation ne sont pas réémis automatiquement après un déplacement ; cette règle reste celle du système existant.
- Aucun changement R2, durée des URL photo toujours configurable. Aucun développement sanitaire ni lancement de l'Étape 4.
