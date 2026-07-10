importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const APP_VERSION="20260710-150553";
const APP_SCOPE_URL=new URL(self.registration.scope);
const APP_INDEX=new URL("index.html",APP_SCOPE_URL).href;

self.addEventListener("install",()=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  const request=event.request;

  if(request.method!=="GET" || request.mode!=="navigate") return;

  event.respondWith(
    fetch(request).catch(async()=>{
      return (await caches.match(request)) ||
             (await caches.match(APP_INDEX));
    })
  );
});
