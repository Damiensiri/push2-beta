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
    pages/
      travail.css
      horaires.css
      paddocks.css
      plan.css
      service.css
      mes-commandes.css
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
      horaires.js
      paddocks.js
      plan.js
      service.js
      mes-commandes.js
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

La migration de `plan.html` vers l’architecture commune est implémentée. Elle
conserve le plan, les cinq marqueurs, le panneau d’information, le halo de
statut, les horaires, les activités possibles, le bouton de réservation,
l’API des statuts, le cache local et l’actualisation toutes les 10 secondes.
Elle a été validée par Damien le 1er juillet 2026.

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
l’affichage des statuts et commentaires. Sa validation sur iPhone reste à
effectuer avant de migrer une page supplémentaire.

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
