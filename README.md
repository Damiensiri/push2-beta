# PWA Écurie Damien Siri

## Projet

**PWA Écurie Damien Siri**

## Dépôts GitHub

- `push2` : Production
- `push2-beta` : Développement / Bêta

Le dépôt `push2-beta` est une copie de l’état actuel de `push2` et devient
désormais le dépôt officiel de développement.

Le dépôt `ecran` ne doit plus être utilisé pour le développement de cette PWA,
car il contient également d’autres projets.

## Environnement bêta

La bêta est accessible à l’adresse :

`https://damiensiri.github.io/push2-beta/`

Le dépôt `push2-beta` ne doit pas contenir de fichier `CNAME`. Les chemins de
la PWA doivent rester compatibles avec le sous-dossier `/push2-beta/` ainsi
qu’avec la racine du domaine de production.

Les notifications OneSignal ne sont pas activées sur la bêta. Elles restent
réservées au domaine de production `app.damiensiri.com`.

## Workflow

1. Tous les développements commencent sur `push2-beta`.
2. Tous les commits sont réalisés sur `push2-beta`.
3. Tous les tests sont effectués sur `push2-beta`.
4. Une fois les tests validés par Damien, les modifications sont synchronisées
   vers `push2`.
5. Aucun commit ou modification directe sur `push2` sans validation explicite
   de Damien.

## Vérifications obligatoires avant publication

Toujours vérifier :

- `APP_VERSION`
- `manifest.json`
- le service worker utilisé par l’application (`OneSignalSDKWorker.js` et
  `OneSignalSDKUpdaterWorker.js` dans l’état actuel du projet)
- `update.html`
- le comportement des mises à jour de la PWA sur iPhone

## Chantier actuellement en cours

Le chantier actuel concerne la centralisation progressive du design et la
gestion des thèmes saisonniers.

La Phase 2 est limitée à la page pilote `travail.html`.

Architecture pilote :

```text
assets/
  css/
    app.css
    pages/
      travail.css
    themes/
      summer.css
      autumn.css
      christmas.css
      spring.css
  js/
    app-config.js
    app-layout.js
    pages/
      travail.js
```

Le thème actif est défini uniquement dans `assets/js/app-config.js`.

`summer` est le thème de référence et doit conserver exactement le rendu
validé avant la refonte. Les thèmes `autumn`, `christmas` et `spring` sont
enregistrés mais restent volontairement non finalisés.

La page `meteo.html` est une exception permanente : son fond et ses animations
météo ne doivent pas être remplacés par le thème global.

La Phase 2 doit également supprimer le micro-scroll des pages courtes par un
calcul correct de la hauteur disponible, sans utiliser de blocage global du
scroll.

État actuel : architecture pilote implémentée dans la version `20260630-4`,
en attente de validation visuelle et fonctionnelle sur iPhone.

La gestion des versions a été validée sur iPhone le 30 juin 2026 : une PWA
installée en version `20260630-1` a chargé la version `20260630-2` sans
suppression ni réinstallation.

### Préparation d’une publication

Avant chaque publication, exécuter depuis la racine du dépôt :

```bash
./scripts/bump-app-version.sh
```

Le script génère une version unique à partir de la date et de l’heure, puis la
synchronise dans `index.html`, `manifest.json`, `OneSignalSDKWorker.js` et
`update.html`. Il synchronise également les paramètres de version des assets
CSS et JavaScript déjà migrés. Il ne crée aucun commit et ne déclenche aucun
push.

## Reprise d’une nouvelle session

À chaque nouvelle conversation ou reprise du projet :

1. Lire le `README.md`.
2. Consulter les derniers commits Git.
3. Vérifier l’état du dépôt avant toute modification.
4. Reprendre exactement le dernier chantier en cours sans repartir d’une
   ancienne version.

## Historique des gros chantiers

- Passage de l’interface bêta en production.
- Harmonisation du plein écran, des Safe Areas et des en-têtes.
- Correction du calcul des créneaux de réservation des paddocks, notamment à
  proximité de l’heure de fermeture.
- Mise en place du chantier de mise à jour et de gestion du cache des PWA déjà
  installées sur iPhone.
- Validation sur la bêta du passage automatique d’une PWA iPhone installée de
  la version `20260630-1` à la version `20260630-2`.

Cette section doit être maintenue afin de résumer les principales évolutions de
la PWA et de retrouver facilement les grandes étapes du projet.

## Documentation

Le `README.md` est la documentation officielle du projet et doit être mis à
jour à chaque évolution importante.

## Règle de prudence

En cas de doute, ne jamais faire d’hypothèse. Demander confirmation à Damien
avant toute modification qui pourrait impacter la production ou modifier
l’architecture du projet.
