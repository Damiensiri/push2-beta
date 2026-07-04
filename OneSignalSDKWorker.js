importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const APP_VERSION="20260704-203233";
const APP_SCOPE_URL=new URL(self.registration.scope);
const APP_ENTRY=new URL(`index.html?v=${APP_VERSION}`,APP_SCOPE_URL).href;
const APP_INDEX=new URL("index.html",APP_SCOPE_URL).href;
const IS_SHARED_BETA_ORIGIN=APP_SCOPE_URL.hostname==="damiensiri.github.io" &&
                            APP_SCOPE_URL.pathname!=="/";

self.addEventListener("install",()=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    if(!IS_SHARED_BETA_ORIGIN){
      const cacheNames=await caches.keys();
      await Promise.all(cacheNames.map(name=>caches.delete(name)));
    }
    await self.clients.claim();

    const openedClients=await self.clients.matchAll({
      type:"window",
      includeUncontrolled:true
    });

    await Promise.all(openedClients.map(client=>{
      const url=new URL(client.url);
      if(url.origin!==self.location.origin) return null;
      if(!url.href.startsWith(self.registration.scope)) return null;
      if(url.searchParams.get("v")===APP_VERSION) return null;
      return client.navigate(APP_ENTRY);
    }));
  })());
});

self.addEventListener("fetch",event=>{
  const request=event.request;

  if(request.method!=="GET" || request.mode!=="navigate") return;

  event.respondWith(
    fetch(request,{cache:"no-store"}).catch(async()=>{
      return (await caches.match(request)) ||
             (await caches.match(APP_INDEX));
    })
  );
});
