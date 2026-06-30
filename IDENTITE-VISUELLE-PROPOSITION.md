# Identité visuelle premium

Statut : **validée et intégrée dans `work/push2` le 23 juin 2026**.

Cette identité sert désormais de référence graphique pour l’application.

## Principes

- Interface mobile prioritaire, pensée pour Safari iPhone et le mode application web.
- Décor animé placé dans une couche positive derrière le contenu, jamais avec un `z-index` négatif.
- Verre translucide, contours lumineux fins, grands rayons et ombres diffuses.
- Mouvements lents, sans animation agressive ni déplacement fonctionnel.
- Respect automatique de `prefers-reduced-motion`.
- Les composants fonctionnels conservent leurs IDs, classes, liens et événements.

## Ambiances solaires

Les heures sont calculées localement pour Brienne-le-Château, sans requête réseau.

| Phase | Déclenchement | Ambiance |
| --- | --- | --- |
| Nuit | Avant le lever et après le crépuscule | Bleu nuit profond, halo lunaire froid |
| Aube | Environ 55 min avant à 35 min après le lever | Indigo, mauve et pêche |
| Matin | Après l’aube jusqu’avant midi solaire | Bleu clair, lumière fraîche |
| Jour | Autour du midi solaire jusqu’à l’approche du coucher | Bleu lumineux, horizon très clair |
| Heure dorée | Environ 115 à 25 min avant le coucher | Bleu adouci, ambre et pêche |
| Crépuscule | De 25 min avant à 50 min après le coucher | Indigo, violet et rose chaud |

La lumière traverse progressivement le ciel entre le lever et le coucher. Les changements de palette utilisent une transition de 2,8 secondes.

## Composants

- **Fond** : trois couleurs verticales, deux halos diffus et un voile lumineux lent.
- **En-tête** : verre renforcé, flou de 22 px, bordure fine et zone sûre iPhone.
- **Boutons carrés** : rayon de 25 px, ombre diffuse, reflet supérieur et pression à 97 %.
- **Boutons de liste** : même matière, chevron discret et pression à 98 %.
- **Titres de section** : petites capsules translucides avec espacement typographique.
- **Notification** : cloche et compteur visuellement modernisés, comportement inchangé.

## Règles de maintenance

1. Vérifier chaque évolution sur iPhone Safari, en mode clair, sombre et application web.
2. Ne jamais modifier la logique métier lors d’une migration visuelle.
3. Préserver les IDs, classes, liens et événements utilisés par les scripts.
4. Garder le moteur solaire et le `theme-color` synchronisés.

Règle critique

La cloche de notification, le compteur non lu, les URLs, les scripts Google Apps Script, OneSignal et les fonctions de navigation ne doivent jamais être modifiés pendant une migration visuelle.
