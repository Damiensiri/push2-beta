# Fonds saisonniers

Ce dossier recevra les illustrations de fond des thèmes saisonniers.

Architecture prévue :

```text
assets/images/themes/
  autumn/
    autumn-bg.webp
    autumn-bg@2x.webp
  christmas/
    christmas-bg.webp
    christmas-bg@2x.webp
  spring/
    spring-bg.webp
    spring-bg@2x.webp
  summer/
    summer-bg.webp
    summer-bg@2x.webp
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
