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

Le chantier concerne la centralisation progressive du design et la gestion des
thèmes saisonniers. Il a repris le 1er juillet 2026 après la validation de
`travail.html` et `horaires.html`.

La Phase 2 progresse page par page dans `push2-beta`. Chaque page possède un
commit et une validation séparés. L’ensemble sera transféré vers `push2`
uniquement lorsque toutes les pages prévues auront été validées.

Architecture pilote :

```text
assets/
  css/
    app.css
    components/
      bottom-nav.css
    pages/
      travail.css
      horaires.css
      paddocks.css
      plan.css
      service.css
      mes-commandes.css
      panier.css
      confirmation.css
      concours.css
      notifications.css
      detail.css
      planningpaddock.css
      mesreservations.css
      index.css
      meteo.css
    themes/
      summer.css
      autumn.css
      christmas.css
      spring.css
  js/
    app-config.js
    app-layout.js
    components/
      bottom-nav.js
    pages/
      travail.js
      horaires.js
      paddocks.js
      plan.js
      service.js
      mes-commandes.js
      panier.js
      confirmation.js
      meteo.js
```

Le thème actif est défini uniquement dans `assets/js/app-config.js`.

`summer` est le thème de référence et doit conserver exactement le rendu
validé avant la refonte. Les thèmes `autumn`, `christmas` et `spring` sont
enregistrés mais restent volontairement non finalisés.

La page `meteo.html` est une exception permanente et contrôlée : son fond et
ses animations météo ne doivent pas être remplacés par le thème global.
Elle participe à la structure du projet et au versioning grâce à ses ressources
dédiées `assets/css/pages/meteo.css` et `assets/js/pages/meteo.js`, mais elle ne
charge volontairement ni `app.css`, ni `app-config.js`, ni `app-layout.js`, ni
les thèmes saisonniers. Elle ne reçoit donc pas `.ambient-stage`, `html::after`
ou le moteur de fond commun.

La Phase 2 doit également supprimer le micro-scroll des pages courtes par un
calcul correct de la hauteur disponible, sans utiliser de blocage global du
scroll.

État actuel : architecture pilote validée sur iPhone dans la version
`20260630-6`. La page courte ne présente plus de micro-scroll ni de fond de
secours visible, tandis qu’un contenu long conserve son défilement naturel.
Le rendu Summer et les fonctionnalités de `travail.html` sont validés.

La migration de `horaires.html` est implémentée. La version `20260630-12`
utilise une seule toile dynamique Summer continue sur la racine `html`, y
compris derrière les Safe Areas, tandis que le `body` reste transparent. Les
effets animés sont portés par une toile fixe dédiée, alignée avec le même fond
sur `html`. La toile utilise `100dvh` lorsque cette unité est disponible, sans
allongement artificiel. Un cache inférieur fixe, indépendant de la hauteur du
document, couvre la Safe Area avec la variable thémable
`--app-safearea-bottom-background`. Une transition masquée de 32 px évite de
créer une nouvelle jonction au sommet de ce cache. Summer reprend
`--sky-bottom`; chaque futur thème pourra fournir sa propre valeur.
L’animation d’entrée de `horaires.html` porte uniquement sur la liste afin de
ne pas déplacer le bouton retour et le titre fixes. La validation sur iPhone
de `travail.html` et `horaires.html` est terminée.

Tests validés par Damien sur iPhone le 30 juin 2026 :

- aucune ligne de démarcation dans la zone inférieure ;
- aucun micro-scroll sur une page courte ;
- scroll naturel conservé sur une page réellement longue ;
- fonctionnement correct après plusieurs fermetures et réouvertures de la
  PWA ;
- rendu Summer conforme au design attendu ;
- placement correct du titre et du bouton retour de `horaires.html`.

La migration de `paddocks.html` vers l’architecture commune est implémentée.
Elle conserve l’API des statuts, le cache local, l’actualisation toutes les
10 secondes, les trois paddocks, le bouton de réservation et la navigation
vers `planningpaddock.html`. Elle a été validée par Damien le 1er juillet 2026.
Les pictogrammes SVG Maison, Grande Voie et Beudot créés pour le récapitulatif
de `planningpaddock.html` remplacent désormais les trois pictogrammes
génériques dans les titres, sans modifier les cartes ni leur fonctionnement.

La migration de `plan.html` vers l’architecture commune est implémentée. Elle
conserve le plan, les cinq marqueurs, le panneau d’information, le halo de
statut, les horaires, les activités possibles, le bouton de réservation,
l’API des statuts, le cache local et l’actualisation toutes les 10 secondes.
Elle a été validée par Damien le 1er juillet 2026.
Dans le panneau d’information, chaque paddock utilise désormais son
pictogramme SVG dédié. Les cinq marqueurs du plan conservent volontairement
leurs icônes de statut Ouvert, Prévision, Fermé ou Hors service.

La migration de `service.html` vers l’architecture commune est implémentée.
Elle conserve le catalogue, le produit mis en avant, le panier local,
l’animation d’ajout, les quantités, EmailJS, l’archivage local des commandes,
le formulaire Google et la navigation vers `mes-commandes.html`. Le panneau du
panier conserve son fond sur toute la hauteur de l’écran, tandis que son
contenu respecte les Safe Areas supérieure et inférieure. Elle a été validée
par Damien le 1er juillet 2026.

Les migrations de `soins.html` et `laverie.html` sont implémentées en
réutilisant directement `service.css` et `service.js`, y compris le panier
validé avec la Dynamic Island. Les deux pages ne fournissent que leur titre et
leur URL de catalogue propre via `data-catalog-url` (`/soins` ou `/laverie`).
Le comportement du catalogue, du panier et de la commande reste donc commun
aux trois pages. Elles ont été validées par Damien le 1er juillet 2026.

La migration de `mes-commandes.html` vers l’architecture commune est
implémentée. Elle conserve l’historique local, la purge des commandes de plus
de six mois, le rapprochement par identifiant avec le Google Sheet ainsi que
l’affichage des statuts et commentaires. Elle a été validée par Damien le
1er juillet 2026.

La migration de `panier.html` vers l’architecture commune est implémentée.
Les boîtes de saisie navigateur ont été remplacées par un formulaire visible
Nom, Prénom et Email placé après le total. Le bouton Commander reste désactivé
tant que le panier est vide, qu’un champ est vide ou que l’adresse email est
invalide. L’envoi EmailJS, l’historique local, `lastOrder`, le vidage du panier
et la navigation vers `confirmation.html` sont conservés. Elle a été validée
par Damien le 1er juillet 2026.

La migration de `confirmation.html` vers l’architecture commune est
implémentée. Elle conserve la lecture de `lastOrder`, le récapitulatif des
articles, le total, le cas sans commande et la navigation vers
`mes-commandes.html`. Elle a été validée par Damien le 1er juillet 2026.

La migration de `concours.html` vers l’architecture commune est implémentée.
Elle conserve l’intégration du calendrier Google, les deux calendriers
sélectionnés, le fuseau Europe/Paris, la note d’abonnement et tous les tarifs.
Cette page n’ayant aucune logique métier propre, elle ne nécessite pas de
fichier JavaScript dédié. Elle a été validée par Damien le 1er juillet 2026.

La migration visuelle de `notifications.html` vers l’architecture commune est
implémentée avec une règle de sécurité renforcée. Son bloc JavaScript métier
reste directement dans la page et a été vérifié caractère par caractère comme
identique à la version précédente. Lors de cette migration, `index.html` et
`detail.html` sont restés strictement inchangés. L’URL API, la clé `alerts_lues`, le cache
`alert_detail_cache`, le lien `detail.html?id=...`, le rafraîchissement toutes
les 60 secondes et le rafraîchissement au retour visible sont conservés. Sa
validation sur iPhone a été confirmée par Damien le 1er juillet 2026.

La migration visuelle de `detail.html` vers l’architecture commune est
implémentée avec le même niveau de prudence. Son bloc JavaScript métier reste
directement dans la page et a été vérifié caractère par caractère comme
identique à la version précédente. L’URL API, la clé `alerts_lues`, le cache
`alert_detail_cache`, le paramètre `id`, le marquage comme lu, les contrôles
d’expiration, le repli sur le cache et le retour par l’historique sont
conservés. `index.html` et `notifications.html` sont restés strictement
inchangés pendant cette migration. Elle a été validée par Damien le
1er juillet 2026.

La migration visuelle initiale de `planningpaddock.html` vers l’architecture
commune a été implémentée sans aucune modification de sa logique métier. Le
bloc JavaScript complet reste directement dans la page et avait été vérifié
caractère par caractère comme identique à la version précédente. La configuration
Firebase, les écoutes temps réel des collections `reservations`, `horaires` et
`restrictions`, la création et l’annulation des réservations, les blocages
1 h 30, les contrôles de fermeture et de chevauchement, les demandes de mise
au paddock et EmailJS sont conservés. Seuls l’ancien habillage embarqué et son
script d’ambiance visuelle ont été remplacés par le thème commun.

Le test du 1er juillet 2026 a validé les annulations, les blocages et les
demandes de mise au paddock. Deux ajustements sans modification de Firebase ont
ensuite été ajoutés : lorsqu’un blocage 1 h 30 entraîne l’affichage de
créneaux d’une heure, chaque créneau porte désormais explicitement la mention
« Libre 1 h ». L’échec EmailJS observé pendant le test provenait du quota
mensuel du service épuisé et non du code de la PWA. L’affichage technique
temporaire utilisé pour ce diagnostic a ensuite été retiré.
La page a ensuite été validée par Damien le 1er juillet 2026.

Une amélioration UX indépendante a ensuite été ajoutée après la validation de
la migration : un bloc compact placé avant le formulaire affiche, en lecture
seule, le premier créneau libre d’une heure disponible aujourd’hui pour
Maison, Grande Voie et Beudot. Il réutilise les données déjà chargées par les
écoutes temps réel existantes des horaires et réservations, sans nouvelle
requête ni aucune écriture Firebase. Le calcul respecte les horaires, le délai
minimum de dix minutes, les réservations et les blocages déjà enregistrés. Un
paddock fermé affiche « Fermé » et une journée sans créneau libre affiche
« Complet ». Les trois pictogrammes sont des SVG locaux originaux.

La migration visuelle de `mesreservations.html` vers l’architecture commune
est implémentée sans modification de sa logique métier. Son bloc JavaScript
reste directement dans la page et a été vérifié caractère par caractère comme
identique à la version précédente. La configuration Firebase, la lecture et
l’annulation des réservations, `myReservations`, `myMises`, les deux sources
Google Sheets, la carte de mises, les statuts, l’historique, la génération du
calendrier et l’actualisation automatique sont conservés. La validation
fonctionnelle et visuelle sur iPhone reste obligatoire avant de poursuivre.

Le 1er juillet 2026, l’ajout au calendrier a cessé de fonctionner sur iPhone
dans Safari comme dans la PWA, aussi bien sur la bêta que sur la production.
Les trois méthodes locales déjà testées (`data:`, Blob et partage natif iOS)
ne permettent plus d’ouvrir l’import Calendrier de manière fiable. La solution
retenue consiste à servir un véritable flux iCalendar en HTTPS depuis une Web
App Google Apps Script indépendante. Le fichier source
`apps-script-calendar-ics.js` a été déployé. Il ne lit et ne modifie aucune
donnée : il transforme uniquement les paramètres reçus en flux ICAL.
`mesreservations.html` utilise désormais son URL publique `/exec` uniquement
sur iPhone et iPad. Le téléchargement Blob existant reste utilisé sur les
autres appareils. L’ouverture du flux iCalendar et l’ajout au Calendrier ont
été validés par Damien sur iPhone le 1er juillet 2026. La migration complète
de `mesreservations.html` est donc validée.

La migration visuelle de `index.html`, dernière page du parcours client hors
exception Météo, est implémentée avec une règle de sécurité maximale. Les cinq
blocs JavaScript sensibles restent directement dans la page et ont été
vérifiés séparément comme strictement identiques à la version précédente :
version et environnement, manifest et service worker, OneSignal, navigation
et horaires, cloche et alertes lues. Tous les identifiants HTML, événements
`onclick`, URLs d’intégration, préchargements et fonctions `go`, `load`,
`updateUI` et `updateBell` sont conservés. Seuls le CSS embarqué et le moteur
d’ambiance visuelle local ont été remplacés par les ressources communes du
thème Summer. L’index conserve sa propre toile pleine hauteur : sa feuille
`assets/css/pages/index.css` désactive uniquement pour cette page le
pseudo-élément global `html::after`, afin de ne pas ajouter le halo du cache
Safe Area sur le fond inférieur. Cette exception ne modifie ni les autres
pages ni leur correction Safe Area. La validation complète sur iPhone reste
obligatoire avant toute publication en production.

La migration contrôlée de `meteo.html` conserve cette page hors de
l’architecture visuelle commune. Son CSS autonome a été déplacé mécaniquement
vers `assets/css/pages/meteo.css` en conservant, dans le même ordre, toutes les
règles du fond animé et les corrections de `meteo-fullscreen.css`. Son
JavaScript a été déplacé sans réécriture vers
`assets/js/pages/meteo.js`. Le chargement de `vigilance-data.js` reste placé
avant le moteur météo. Ces trois ressources portent une version synchronisée
par `scripts/bump-app-version.sh`. Aucun thème saisonnier, fond commun,
`.ambient-stage` ou cache `html::after` n’est chargé. Une éventuelle future
barre d’accès rapide devra être intégrée comme composant isolé et ne pourra pas
introduire `app.css` ou le moteur de fond commun dans cette page.

## Dock d’accès rapide

Avant l’ajout du dock, l’état complet validé a été conservé par le tag Git
`backup-avant-dock-20260702`, placé sur le commit `631de22`.

Le dock commun est défini uniquement dans :

```text
assets/css/components/bottom-nav.css
assets/js/components/bottom-nav.js
```

Les pages migrées et `meteo.html` ne contiennent que les références vers ces
deux ressources. Le composant injecte quatre accès : Accueil, Notifications,
Plan et Mes réservations. Son ordre, ses libellés et ses SVG sont centralisés
dans `bottom-nav.js`.

Sur `index.html`, le composant déplace le nœud existant `#bellBox` dans le
dock. Il ne le clone pas et conserve `#bellBadge`, le `onclick`, les IDs et la
logique JavaScript historique de mise à jour. Les autres pages affichent un
simple accès à Notifications sans compteur artificiel. La centralisation
éventuelle du compteur sur toutes les pages reste un chantier séparé.

L’emplacement libéré dans l’en-tête de l’index reçoit uniquement un aperçu
visuel non interactif de la future zone utilisateur. La gestion du prénom, de
la photo et du profil n’est pas implémentée.

Le style du dock ne contient aucune couleur propre à une saison. Il consomme
exclusivement les variables `--bottom-nav-*` et `--user-preview-*` fournies
par les thèmes. Le thème Summer définit ses variantes claire et sombre ; les
thèmes préparés exposent les mêmes points d’extension. La météo fournit ces
variables dans sa propre feuille sans charger `app.css`, les thèmes ou le
moteur de fond commun.

Le composant ajoute uniquement l’espace inférieur nécessaire aux pages
concernées. Il respecte la Safe Area iPhone, se masque pendant la saisie dans
un formulaire ainsi que lors de l’ouverture des panneaux Panier, Plan et de
la confirmation Paddock, et ne bloque pas le défilement des pages longues.

## Fond global et Safe Area iPhone — technique validée

Cette architecture est la référence à conserver pour les pages migrées. Elle
résout une particularité d’iOS : la zone du Home Indicator peut être repeinte
différemment du viewport CSS, même lorsque la toile principale est prolongée.

### Répartition des surfaces

- `html` porte le fond principal avec `--app-background` et la couleur de
  secours `--sky-bottom`.
- `body.app-page` reste transparent afin de ne jamais créer une seconde
  surface visible.
- `.ambient-stage` est une toile fixe hors du flux, avec le même
  `--app-background`, et porte l’effet lumineux animé.
- `.page` reste au-dessus des couches de fond avec son `z-index`.
- Le fond utilise `100vh` en repli et `100dvh` lorsque cette unité est prise en
  charge.

Chaque page utilisant cette architecture doit conserver, directement dans le
`body`, la couche suivante :

```html
<div class="ambient-stage" aria-hidden="true"></div>
```

### Cache inférieur thémable

Le raccord iOS est neutralisé par `html::after`, une surcouche fixe qui ne
participe pas à la hauteur du document :

```css
html::after{
  content:"";
  position:fixed;
  right:0;
  bottom:0;
  left:0;
  height:calc(var(--safe-bottom) + 32px);
  background:var(--app-safearea-bottom-background);
  -webkit-mask-image:linear-gradient(
    to bottom,
    transparent 0,
    #000 32px,
    #000 100%
  );
  mask-image:linear-gradient(
    to bottom,
    transparent 0,
    #000 32px,
    #000 100%
  );
  pointer-events:none;
}
```

La transition masquée de 32 px fond progressivement le cache dans la toile et
évite de déplacer simplement la ligne de démarcation plus haut.

Le thème Summer définit :

```css
--app-safearea-bottom-background:var(--sky-bottom);
```

Les futurs thèmes `autumn`, `christmas` et `spring` devront définir cette même
variable avec la teinte correspondant au bas de leur propre fond. La technique
reste donc commune ; seule la valeur visuelle appartient au thème.

### Règles à ne pas casser

- Ne pas remettre de fond opaque sur `body.app-page`.
- Ne pas supprimer le cache `html::after` ni son masque progressif.
- Ne pas augmenter la hauteur du document pour couvrir la Safe Area.
- Ne pas utiliser `overflow:hidden` global sur `html` ou `body`.
- Conserver `--safe-bottom:env(safe-area-inset-bottom,0px)`.
- Conserver les couches de fond en `position:fixed`, hors du flux du document.
- Vérifier après chaque évolution une page courte et une page longue dans la
  PWA installée sur iPhone.
- `meteo.html` reste exclue : elle conserve son propre fond animé et ne doit pas
  adopter cette architecture globale.

Référence validée : version `20260630-12`, commit `ecd929b`.

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
- Validation de l’architecture pilote Summer sur `travail.html`, avec gestion
  correcte des pages courtes et longues sur iPhone.
- Validation définitive du fond Summer sur `travail.html` et `horaires.html`,
  avec cache inférieur thémable supprimant la démarcation de la Safe Area
  iPhone sans micro-scroll.

Cette section doit être maintenue afin de résumer les principales évolutions de
la PWA et de retrouver facilement les grandes étapes du projet.

## Documentation

Le `README.md` est la documentation officielle du projet et doit être mis à
jour à chaque évolution importante.

## Règle de prudence

En cas de doute, ne jamais faire d’hypothèse. Demander confirmation à Damien
avant toute modification qui pourrait impacter la production ou modifier
l’architecture du projet.
