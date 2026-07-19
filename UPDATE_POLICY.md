# Politique de mise à jour PWA

Toute nouvelle version doit être récupérée sur iPhone sans déconnecter le client.

- Augmenter `APP_VERSION` dans `index.html`, `OneSignalSDKWorker.js` et `update.html`.
- Appeler `registration.update()` sans désinscrire le service worker.
- Ne jamais vider `localStorage` ou supprimer le jeton de session pendant une mise à jour.
- Ne jamais révoquer les sessions pour forcer une nouvelle version.
- Ne jamais désinscrire OneSignal ni recréer les abonnements push.
- Ne pas supprimer tous les caches depuis `update.html`.
