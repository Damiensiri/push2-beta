# Fonds saisonniers

Ce dossier recevra les illustrations de fond des thèmes saisonniers.

Architecture prévue :

```text
assets/images/themes/
  autumn/
    autumn-bg.webp
    autumn-bg@2x.webp
  summer/
    summer-sunrise.webp
    summer-sunrise@2x.webp
    summer-day.webp
    summer-day@2x.webp
    summer-sunset.webp
    summer-sunset@2x.webp
    summer-night.webp
    summer-night@2x.webp
```

Chaque image doit être conçue pour la PWA mobile et rester derrière les cartes.
Les pages ne doivent pas référencer ces images directement.

L’activation se fait uniquement dans le fichier CSS du thème concerné, via :

```css
:root[data-theme="autumn"]{
  --theme-background-image:url("../../images/themes/autumn/autumn-bg.webp");
}

@supports (background-image:image-set(url("../../images/themes/autumn/autumn-bg.webp") 1x)){
  :root[data-theme="autumn"]{
    --theme-background-image:
      image-set(
        url("../../images/themes/autumn/autumn-bg.webp") 1x,
        url("../../images/themes/autumn/autumn-bg@2x.webp") 2x
      );
  }
}
```

Le fallback CSS `--app-background` doit rester présent afin que l’application
reste lisible si l’image n’est pas disponible.

Summer utilise quatre illustrations selon l’heure :

- `sunrise` : 06h00 → 10h00 ;
- `day` : 10h00 → 17h00 ;
- `sunset` : 17h00 → 21h00 ;
- `night` : 21h00 → 06h00.

Le changement est piloté par `assets/js/app-layout.js` via `data-daypart`.
Les transitions entre deux ambiances se font par fondu, sans overlay horaire.
