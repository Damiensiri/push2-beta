# CHEVAUX — Étape 4, bêta — 6 septembre 2026

Suivi sanitaire éditable dans Backstage et par les propriétaires dans Mes chevaux : vaccination, vermifuge, ferrure/parage et dentiste. Dates réalisées et commentaires saisis manuellement. Raccourcis facultatifs d’échéance calculés depuis la date réalisée : vaccination 1/6/12 mois, ferrure/parage 5/6/7 semaines, dentiste 12 mois ; vermifuge manuel. Aucune sélection automatique ; date toujours modifiable. Les fins de mois sont plafonnées au dernier jour du mois cible. Historique chargé à la demande, 50 interventions par page. Les échéances courantes sont intégrées à la requête de fiche (30 maximum).

## Livraison

Migration 0026_horse_health.sql réellement appliquée à D1 ecurie-notifications-beta après export de sauvegarde : tables horse_health_records et horse_notifications, index et déclencheurs d’annulation/verrouillage. Historique conservé, suppressions logiques. Aucune donnée sanitaire de démonstration insérée à distance.

Worker déployé : 83bb6015-b82c-4388-8fb5-eee2d5a5e2a8. Mailer Beta : déploiement existant mis à jour en version 7 ; autorisation Google accordée, connexion Worker vérifiée sans envoyer de courriel. Production inchangée.

Principaux fichiers : notifications-backend/src/horse-health.js, src/horses.js, src/worker.js, wrangler.toml et migration 0026 ; assets/js/horse-health.js et assets/css/horse-health.css dans les deux dépôts ; mes-chevaux.html et son contrôleur côté PWA ; horses.html et son contrôleur côté Backstage ; mailer/mailer-beta-complet.gs et horse-health-extension.gs.

## Rappels

Cron quotidien à 07:00 UTC (09:00 en été, 08:00 en hiver en France). HORSE_REMINDER_OFFSETS configurable, valeur initiale 7,0 ; HORSE_REMINDER_BATCH_SIZE=50 ; HORSE_HEALTH_MAIL_ENABLED=true. Les modifications de configuration concernent la préparation des prochains rappels, sans recalcul automatique des lignes déjà préparées.

Les écritures préparent les notifications. Correction, remplacement, suppression, départ/archivage ou retrait de propriétaire annulent les notifications obsolètes. La destination est résolue à nouveau au moment de l’envoi. Les mutations concernées sont temporairement refusées pendant un envoi actif. Envoi confirmé : pas de nouvel envoi. Échec certain avant envoi : trois tentatives maximum. Résultat incertain : pas de relance automatique ; état visible dans Backstage. Aucun mail réel aux propriétaires envoyé pour les tests.

## Validation

- 49 tests Worker/PWA réussis, 0 échec : autorisations, validation, historique, versions concurrentes, remplacement, changement de propriétaires, annulation, deux traitements Cron simultanés, envoi incertain, adaptateur Apps Script et protections existantes.
- 15 tests Backstage réussis, 0 échec.
- Contrôle visuel du formulaire sanitaire à 393 px, sans débordement des champs date.
- API bêta : fiche avec healthDue et historique vide répondent 200 ; accès sans authentification refusé ; mailer refuse un identifiant de rappel invalide après résolution auprès du Worker.

## Mesures D1 distantes

Trois appels par route avant et après, sur les mêmes données bêta (historique sanitaire encore vide). Temps médian Worker, pas une mesure de latence utilisateur.

| Route | Requêtes avant → après | Lignes lues avant → après | Lignes écrites | Temps médian avant → après |
|---|---:|---:|---:|---:|
| Planning Backstage | 6 → 6 | 19 → 19 | 0 | 46 → 41 ms |
| Fiche cheval Backstage | 2 → 2 | 5 → 6 | 0 | 42 → 38 ms |
| Historique sanitaire à la demande | nouvelle : 2 | 2 | 0 | 47 ms |

Ces petits échantillons ne démontrent pas une accélération. Les volumes sanitaires réels et écritures du Cron restent à mesurer après utilisation.

## Limites et points à surveiller

- Vérifier la réception du premier rappel réel, le quota MailApp et les états « À vérifier » / « Envoi en cours ». Un envoi interrompu après prise en charge ne sera pas relancé automatiquement, pour éviter les doublons.
- Un retour au statut actif ne réarme pas automatiquement une notification déjà annulée pour la même version ; corriger l’échéance pour préparer une nouvelle version si nécessaire.
- Les propriétaires peuvent ajouter, corriger et supprimer les interventions de leurs chevaux ; les autorisations sont vérifiées côté Worker. Les métadonnées d’envoi restent administratives.
- Une vaccination de libellé différent constitue un suivi indépendant. Le libellé d’un suivi existant n’est pas interchangeable : créer une nouvelle intervention pour un autre suivi.
- Aucun changement au TTL configurable des photos R2. Aucune étape supplémentaire démarrée.
