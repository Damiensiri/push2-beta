# Fonds saisonniers

Ce dossier contient les illustrations de fond des thèmes saisonniers.

Architecture prévue :

```text
assets/images/themes/
  autumn/
    autumn-dawn.webp
    autumn-day.webp
    autumn-sunset.webp
    autumn-night.webp
  christmas/
    christmas-dawn.webp
    christmas-day.webp
    christmas-sunset.webp
    christmas-night.webp
  spring/
    spring-dawn.webp
    spring-day.webp
    spring-sunset.webp
    spring-night.webp
  summer/
    summer-dawn.webp
    summer-dawn@2x.webp
    summer-day.webp
    summer-day@2x.webp
    summer-sunset.webp
    summer-sunset@2x.webp
    summer-night.webp
    summer-night@2x.webp
  winter/
    winter-dawn.webp
    winter-day.webp
    winter-sunset.webp
    winter-night.webp
```

Chaque image doit être conçue pour la PWA mobile et rester derrière les cartes.
Les pages ne doivent pas référencer ces images directement.

L’activation se fait uniquement dans le fichier CSS du thème concerné, via :

```css
:root[data-theme="autumn"][data-daypart="day"]{
  --theme-background-image:url("../../images/themes/autumn/autumn-day.webp");
}
```

Le fallback CSS `--app-background` doit rester présent afin que l’application
reste lisible si l’image n’est pas disponible.

Chaque thème peut utiliser quatre illustrations selon la vraie lumière du jour
à Brienne-le-Château :

- `dawn` : lever du soleil - 45 min → lever du soleil + 45 min ;
- `day` : fin de `dawn` → coucher du soleil - 1h ;
- `sunset` : coucher du soleil - 1h → coucher du soleil + 30 min ;
- `night` : tout le reste.

Le changement est piloté par `assets/js/app-layout.js` via `data-daypart`.
Les transitions entre deux ambiances se font par fondu, sans overlay horaire.
Les horaires `sunrise/sunset` viennent d’Open-Meteo et sont mis en cache une
fois par jour. Si l’API ne répond pas, un fallback mensuel local garde un rendu
cohérent.

Important : seules les images du thème actif sont réellement utilisées par le
navigateur. Les images des autres saisons peuvent donc rester présentes dans le
dépôt sans alourdir le chargement quotidien de la PWA.

Quand un thème dispose d’images `@2x`, le CSS peut utiliser `image-set()`.
Quand une seule image WebP est fournie, on utilise simplement cette image afin
de ne pas dupliquer inutilement le poids du projet.
