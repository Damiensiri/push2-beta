importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const APP_VERSION="20260629-5";
const APP_ENTRY=`/index.html?v=${APP_VERSION}`;

self.addEventListener("install",()=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const cacheNames=await caches.keys();
    await Promise.all(cacheNames.map(name=>caches.delete(name)));
    await self.clients.claim();

    const openedClients=await self.clients.matchAll({
      type:"window",
      includeUncontrolled:true
    });

    await Promise.all(openedClients.map(client=>{
      const url=new URL(client.url);
      if(url.origin!==self.location.origin) return null;
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
             (await caches.match("/index.html"));
    })
  );
});
