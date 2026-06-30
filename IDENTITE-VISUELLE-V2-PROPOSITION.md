# Identité visuelle premium V2

Statut : **validée et intégrée dans `work/push2` le 23 juin 2026**.

Cette V2 affine la page d'accueil sans modifier les fonctions métier, les liens, les URLs, OneSignal, la cloche, les compteurs, les IDs ni les classes utilisées par les scripts.

## Ajustements réalisés

- **Header** : rendu invisible, sans barre, sans fond, sans contour et sans ombre. L'en-tête se fond dans le décor.
- **Logo** : bulle supprimée ; le logo reste dans sa couleur originale, y compris en mode sombre.
- **Pilule horaires** : contraste renforcé et états immédiatement lisibles :
  - vert pour les écuries ouvertes ;
  - rouge pour les écuries fermées ;
  - orange pour les horaires exceptionnels.
- **Icônes SVG** : présence légèrement augmentée avec une taille et une ombre un peu plus affirmées, sans changer le style sobre.
- **Theme-color iOS/PWA** : couleur système synchronisée avec la phase de la journée.
- **Moteur solaire** : calcul amélioré avec équation du temps et correction de l'angle solaire pour Brienne-le-Château.

## Palettes theme-color

| Phase | Couleur système |
| --- | --- |
| Nuit | `#071328` |
| Aube | `#26385d` |
| Matin | `#72caff` |
| Journée | `#5fc6ff` |
| Heure dorée | `#d58b65` |
| Crépuscule | `#26375f` |

## Vérification solaire

Contrôle indicatif pour Brienne-le-Château :

| Date | Lever | Midi solaire | Coucher |
| --- | --- | --- | --- |
| 23 juin 2026 | 05:40 | 13:44 | 21:47 |
| 21 décembre 2026 | 08:30 | 12:40 | 16:49 |
| 21 mars 2026 | 06:45 | 12:50 | 18:54 |
| 23 septembre 2026 | 07:28 | 13:34 | 19:40 |

## Règle de maintenance

Cette version est la référence intégrée. Toute évolution future doit préserver la logique métier et être vérifiée page par page.
