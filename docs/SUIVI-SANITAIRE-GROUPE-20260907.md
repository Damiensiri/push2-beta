# Suivi sanitaire groupé — 7 septembre 2026

Backstage Chevaux : sélection explicite de 1 à 50 chevaux parmi la liste paginée, type, libellé, date réalisée, échéance facultative et commentaire commun. Raccourcis de dates identiques au suivi individuel. Chaque cheval reçoit une entrée indépendante, visible dans sa fiche et corrigeable individuellement. Les chevaux partis/archivés sont identifiés ; seuls les chevaux actifs ont des rappels, conformément au fonctionnement existant.

POST /api/admin/horses/health-batch réservé à l’administration. Validation de toute la sélection avant écriture. Mise à jour de la série précédente, insertion des entrées et préparation des rappels dans un même batch D1 atomique. Refus complet si un rappel en cours empêche la modification. Clé de création déterministe par identifiant de tentative, contenu normalisé et cheval : une nouvelle tentative identique ne duplique ni les entrées ni les rappels.

Pas de migration ni de modification des fiches ou plannings existants. 5 instructions D1 par requête groupée, indépendamment du nombre de chevaux. Notifications préparées selon les propriétaires courants, dates et réglages existants ; pas d’envoi immédiat déclenché par le formulaire.

Tests : 52 Worker/PWA bêta et 48 production ; 16 Backstage bêta et 12 production. Tests d’autorisation, validation sans écriture partielle, retry sans doublons, rappels pour chaque propriétaire, correction individuelle et rollback complet en cas de rappel en cours. Test navigateur sur données fictives : deux chevaux, vaccination et échéance à un an, enregistrement simulé. Aucune intervention ni aucun e-mail de test créé en production.
