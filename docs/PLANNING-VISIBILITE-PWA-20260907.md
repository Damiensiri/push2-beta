# Visibilité du planning dans la PWA — 7 septembre 2026

**Règle finale : OFF par défaut pour travail, longe, repos, autre et paddock sans demande. Propriétaire, cours, concours et paddock avec demande sont automatiquement visibles. ON manuel reste possible pour les autres tâches. Les choix déjà enregistrés sont conservés ; aucune migration supplémentaire. Une infobulle dans la fiche PWA explique la publication selon la pension. Les paragraphes suivants décrivent la bascule initiale.**

Migration 0028 : ajout du type cours et de pwa_visible (0 par défaut), conservation des données, identifiants, indexes, séquence et relations. Aucun changement des réservations paddock ni des activités personnelles.

L’API propriétaire ne renvoie que les tâches personnelles, les cours, les concours, les paddocks avec request_id et les tâches explicitement publiées. La publication automatique est calculée, indépendante du drapeau manuel. Un ancien client Backstage qui ne transmet pas le drapeau conserve sa valeur sur PATCH ; POST reste OFF. Une création en lot applique le même choix à chaque jour. Les réservations paddock restent visibles comme auparavant.

Backstage : interrupteur OFF par défaut, choix conservé en modification, publication automatique indiquée pour les exceptions. Le retrait du lien à une demande rend le paddock privé sauf publication manuelle. Les tâches restent toutes dans Backstage, hors activités privées du propriétaire. Bêta alignée sur le cloisonnement déjà présent en production.

Validation : 51 tests Worker/PWA bêta, 47 production ; 16 tests Backstage bêta, 12 production. Test navigateur du formulaire réel avec données locales : OFF par défaut, cours automatique, paddock manuel OFF, paddock lié automatique. Répétition des migrations sur exports distants : 10 tâches bêta et 270 production conservées. Production : 64 tâches automatiquement visibles et 206 tâches masquées par défaut, sans suppression.

Retour arrière : tag before-planning-visibility-20260907 sur les quatre dépôts. Sauvegardes SQL privées hors dépôts dans planning-visibility-backups-20260907. Ne pas restaurer un ancien export sur de nouvelles écritures. L’ancien Worker n’applique pas la règle de confidentialité et ne reconnaît pas cours en modification : privilégier une correction en avant ou garder le nouveau Worker pour revenir uniquement aux interfaces précédentes.
