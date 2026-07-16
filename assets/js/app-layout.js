(function initializeAppLayout(){
  const authPage=location.pathname.split("/").pop()==="connexion.html";
  const authToken=localStorage.getItem("ecurie_beta_session")||"";
  if(!authPage){
    document.documentElement.style.visibility="hidden";
    if(!authToken){
      location.replace("connexion.html");
      return;
    }
    fetch("https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/auth/me",{
      headers:{authorization:"Bearer "+authToken},cache:"no-store"
    }).then(async response=>{
      if(!response.ok)throw new Error("Session invalide");
      const data=await response.json();
      document.documentElement.style.visibility="";
      initializePushIdentity(data.user);
    }).catch(()=>{
      localStorage.removeItem("ecurie_beta_session");
      location.replace("connexion.html");
    });
  }else if(authToken){
    document.documentElement.style.visibility="hidden";
  }

  function initializePushIdentity(user){
    if(!user?.id)return;
    const endpoint="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/push/subscription";
    const installationKey="ecurie_beta_push_installation";
    let installationId=localStorage.getItem(installationKey)||"";
    if(!installationId){installationId=crypto.randomUUID();localStorage.setItem(installationKey,installationId);}
    async function saveSubscription(subscriptionId,method="PUT"){
      if(!subscriptionId)return;
      const token=localStorage.getItem("ecurie_beta_session")||"";
      if(!token)return;
      const response=await fetch(endpoint,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},
        body:JSON.stringify({subscriptionId,installationId}),cache:"no-store"});
      if(!response.ok)throw new Error("Enregistrement push refusé");
    }
    window.OneSignalDeferred=window.OneSignalDeferred||[];
    window.EcuriePushIdentity={
      logout(){return new Promise(resolve=>window.OneSignalDeferred.push(async OneSignal=>{
        try{
          const subscriptionId=OneSignal.User.PushSubscription.id;
          if(subscriptionId)await saveSubscription(subscriptionId,"DELETE");
          await OneSignal.logout();
        }catch(error){}finally{resolve();}
      }));}
    };
    window.OneSignalDeferred.push(async OneSignal=>{
      try{
        await OneSignal.init({appId:"186e6f3b-def4-4b8e-8700-650456ff93cc",notifyButton:{enable:false},welcomeNotification:{disable:true},
          serviceWorkerPath:"push2-beta/OneSignalSDKWorker.js",serviceWorkerParam:{scope:"/push2-beta/"},
          promptOptions:{slidedown:{prompts:[{type:"push",autoPrompt:true,text:{actionMessage:"Souhaitez-vous recevoir les notifications de l’écurie ?",acceptButton:"Autoriser",cancelButton:"Plus tard"}}]}}});
        await OneSignal.login(`beta-user-${user.id}`);
        const registerCurrent=async()=>{
          const subscriptionId=OneSignal.User.PushSubscription.id;
          if(subscriptionId)await saveSubscription(subscriptionId);
        };
        await registerCurrent();
        OneSignal.User.PushSubscription.addEventListener("change",event=>{
          const subscriptionId=event?.current?.id||OneSignal.User.PushSubscription.id;
          if(subscriptionId)saveSubscription(subscriptionId).catch(()=>{});
        });
      }catch(error){console.warn("Identification push indisponible",error);}
    });
    if(!document.querySelector('script[data-onesignal-beta]')){
      const script=document.createElement("script");script.src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";script.defer=true;script.dataset.onesignalBeta="";document.head.appendChild(script);
    }
  }
  const config=window.APP_CONFIG || {};
  const themes=Array.isArray(config.themes)?config.themes:["summer"];
  const themeStorageKey="ecurie-active-theme-v1";
  const dayparts=["dawn","day","sunset","night"];
  const sunCachePrefix="ecurie-theme-sun-v2:";
  const latitude=48.391;
  const longitude=4.527;
  const timeZone="Europe/Paris";
  const themeConfigUrl=String(config.themeConfigUrl||"").trim();
  const themeConfigTimeoutMs=Number(config.themeConfigTimeoutMs)||1200;
  const themeConfigRefreshMs=Number(config.themeConfigRefreshMs)||60000;
  const configuredTheme=themes.includes(config.theme)?config.theme:"summer";
  let activeTheme=readStoredTheme()||seasonalFallbackTheme()||configuredTheme;
  let lastThemeConfigCheck=0;

  document.documentElement.dataset.theme=activeTheme;

  function seasonalFallbackTheme(){
    try{
      const parts={};
      new Intl.DateTimeFormat("en-CA",{
        timeZone,
        month:"2-digit",
        day:"2-digit"
      }).formatToParts(new Date()).forEach(part=>{
        if(part.type!=="literal")parts[part.type]=part.value;
      });

      const month=Number(parts.month);
      const day=Number(parts.day);
      const dayKey=month*100+day;
      let themeName="summer";

      if(dayKey>=1201||dayKey<=102){
        themeName="christmas";
      }else if(dayKey>=103&&dayKey<=319){
        themeName="winter";
      }else if(dayKey>=320&&dayKey<=620){
        themeName="spring";
      }else if(dayKey>=621&&dayKey<=921){
        themeName="summer";
      }else if(dayKey>=922&&dayKey<=1130){
        themeName="autumn";
      }

      return themes.includes(themeName) ? themeName : "";
    }catch(error){
      return "";
    }
  }

  function readStoredTheme(){
    try{
      const raw=localStorage.getItem(themeStorageKey);
      if(!raw)return "";
      const value=JSON.parse(raw);
      const themeName=typeof value==="string" ? value : value?.theme;
      return themes.includes(themeName) ? themeName : "";
    }catch(error){
      return "";
    }
  }

  function writeStoredTheme(themeName){
    if(!themes.includes(themeName))return;
    try{
      localStorage.setItem(themeStorageKey,JSON.stringify({
        theme:themeName,
        updatedAt:new Date().toISOString()
      }));
    }catch(error){}
  }

  function fadeCurrentStage(transitionDuration){
    const stage=document.querySelector(".ambient-stage");
    if(!stage||!transitionDuration)return;

    const style=getComputedStyle(stage);
    const fade=document.createElement("div");
    const existing=stage.querySelector(".daypart-fade");

    if(existing)existing.remove();

    fade.className="daypart-fade";
    fade.setAttribute("aria-hidden","true");
    fade.style.setProperty("--daypart-transition-duration",transitionDuration+"ms");
    fade.style.backgroundColor=style.backgroundColor;
    fade.style.backgroundImage=style.backgroundImage;
    fade.style.backgroundRepeat=style.backgroundRepeat;
    fade.style.backgroundPosition=style.backgroundPosition;
    fade.style.backgroundSize=style.backgroundSize;
    stage.appendChild(fade);

    requestAnimationFrame(()=>{
      fade.classList.add("is-fading");
    });

    setTimeout(()=>{
      fade.remove();
    },transitionDuration+1200);
  }

  function applyThemeMeta(){
    const themeMeta=document.querySelector('meta[name="theme-color"]');
    if(!themeMeta||!document.body)return;

    const themeColor=getComputedStyle(document.body)
      .getPropertyValue("--browser-theme-color")
      .trim();

    if(themeColor)themeMeta.setAttribute("content",themeColor);
  }

  function setActiveTheme(themeName,options){
    const settings=options||{};
    if(!themes.includes(themeName))return false;

    if(activeTheme!==themeName){
      fadeCurrentStage(Number(settings.transitionDuration)||0);
      activeTheme=themeName;
    }

    document.documentElement.dataset.theme=activeTheme;
    if(document.body)document.body.dataset.theme=activeTheme;
    if(settings.persist)writeStoredTheme(activeTheme);
    applyThemeMeta();
    return true;
  }

  function withCacheBust(url){
    try{
      const parsed=new URL(url,location.href);
      parsed.searchParams.set("_",String(Date.now()));
      return parsed.toString();
    }catch(error){
      return url+(url.includes("?")?"&":"?")+"_="+Date.now();
    }
  }

  function pickThemeFromConfig(value){
    const themeName=String(value?.theme||value?.activeTheme||value?.currentTheme||"")
      .trim()
      .toLowerCase();
    return themes.includes(themeName) ? themeName : "";
  }

  async function fetchThemeConfig(){
    if(!themeConfigUrl)return null;

    const controller=typeof AbortController==="function" ? new AbortController() : null;
    const timer=controller ? setTimeout(()=>controller.abort(),themeConfigTimeoutMs) : null;

    try{
      const response=await fetch(withCacheBust(themeConfigUrl),{
        cache:"no-store",
        signal:controller?.signal
      });
      if(!response.ok)throw new Error("Configuration thème "+response.status);
      return await response.json();
    }finally{
      if(timer)clearTimeout(timer);
    }
  }

  async function syncRemoteTheme(options){
    const settings=options||{};
    if(!themeConfigUrl)return;
    const now=Date.now();

    if(!settings.force && now-lastThemeConfigCheck<themeConfigRefreshMs)return;
    lastThemeConfigCheck=now;

    try{
      const remoteConfig=await fetchThemeConfig();
      const remoteTheme=pickThemeFromConfig(remoteConfig);
      if(remoteTheme){
        setActiveTheme(remoteTheme,{
          transitionDuration:Number(settings.transitionDuration)||1000,
          persist:true
        });
      }
    }catch(error){
      /* Hors réseau ou admin indisponible : on conserve le dernier thème connu. */
    }
  }

  function forcedDaypart(){
    return "";
  }

  function localClock(date){
    const parts={};
    new Intl.DateTimeFormat("en-CA",{
      timeZone,
      year:"numeric",
      month:"2-digit",
      day:"2-digit",
      hour:"2-digit",
      minute:"2-digit",
      hourCycle:"h23",
    }).formatToParts(date).forEach(part=>{
      if(part.type!=="literal")parts[part.type]=part.value;
    });

    return{
      dateKey:`${parts.year}-${parts.month}-${parts.day}`,
      minutes:Number(parts.hour)*60+Number(parts.minute),
      month:Number(parts.month)
    };
  }

  function fallbackSunTimes(month,dateKey){
    const monthly=[
      [500,1020],
      [460,1065],
      [400,1115],
      [340,1165],
      [295,1210],
      [270,1245],
      [285,1235],
      [325,1190],
      [370,1125],
      [420,1060],
      [465,1015],
      [500,1000]
    ];
    const pair=monthly[Math.max(0,Math.min(11,month-1))]||[390,1260];
    return{dateKey,sunrise:pair[0],sunset:pair[1],source:"fallback"};
  }

  function readCachedSunTimes(dateKey){
    try{
      const raw=localStorage.getItem(sunCachePrefix+dateKey);
      if(!raw)return null;
      const value=JSON.parse(raw);
      if(value&&value.dateKey===dateKey&&Number.isFinite(value.sunrise)&&Number.isFinite(value.sunset)){
        return{dateKey,sunrise:value.sunrise,sunset:value.sunset,source:"cache"};
      }
    }catch(error){}
    return null;
  }

  function daypartFor(minutes,times){
    const dawnStart=times.sunrise-45;
    const dawnEnd=times.sunrise+45;
    const sunsetStart=times.sunset-60;
    const sunsetEnd=times.sunset+30;

    if(minutes>=dawnStart&&minutes<dawnEnd)return"dawn";
    if(minutes>=dawnEnd&&minutes<sunsetStart)return"day";
    if(minutes>=sunsetStart&&minutes<sunsetEnd)return"sunset";
    return"night";
  }

  function applyInitialDaypartHint(){
    const forced=forcedDaypart();
    if(forced){
      document.documentElement.dataset.daypart=forced;
      return;
    }

    const clock=localClock(new Date());
    const times=readCachedSunTimes(clock.dateKey)||fallbackSunTimes(clock.month,clock.dateKey);
    document.documentElement.dataset.daypart=daypartFor(clock.minutes,times);
  }

  try{
    applyInitialDaypartHint();
  }catch(error){
    document.documentElement.dataset.daypart="day";
  }

  function goBack(){
    const page=document.getElementById("page");
    const usesSlide=document.body.dataset.pageTransition==="slide";
    const delay=usesSlide?350:300;

    if(usesSlide && page){
      page.classList.add("slide-out");
    }else if(page){
      page.classList.remove("active");
      page.classList.add("exit");
    }

    setTimeout(()=>{
      location.href="index.html";
    },delay);
  }

  function initializeThemeBackground(){
    const defaultTransition=25000;
    const resumeTransition=1000;
    let scheduleTimer;
    let currentTimes;

    function minutesFromLocalTime(value){
      const time=String(value||"").split("T")[1]||"";
      const parts=time.split(":").map(Number);
      if(parts.length<2||Number.isNaN(parts[0])||Number.isNaN(parts[1]))return null;
      return parts[0]*60+parts[1];
    }

    function writeCachedSunTimes(dateKey,times){
      try{
        localStorage.setItem(sunCachePrefix+dateKey,JSON.stringify({
          dateKey,
          sunrise:Math.round(times.sunrise),
          sunset:Math.round(times.sunset)
        }));
      }catch(error){}
    }

    async function fetchSunTimes(dateKey){
      const params=new URLSearchParams({
        latitude:String(latitude),
        longitude:String(longitude),
        daily:"sunrise,sunset",
        timezone:timeZone,
        forecast_days:"1"
      });
      const response=await fetch("https://api.open-meteo.com/v1/forecast?"+params.toString(),{
        cache:"no-store"
      });
      if(!response.ok)throw new Error("Open-Meteo sunrise/sunset "+response.status);
      const data=await response.json();
      const sunrise=minutesFromLocalTime(data?.daily?.sunrise?.[0]);
      const sunset=minutesFromLocalTime(data?.daily?.sunset?.[0]);
      if(!Number.isFinite(sunrise)||!Number.isFinite(sunset))throw new Error("Open-Meteo sunrise/sunset incomplet");
      const times={dateKey,sunrise,sunset,source:"open-meteo"};
      writeCachedSunTimes(dateKey,times);
      return times;
    }

    function nextBoundaryDelay(minutes,times){
      const boundaries=[
        times.sunrise-45,
        times.sunrise+45,
        times.sunset-60,
        times.sunset+30,
        1440+times.sunrise-45
      ].filter(Number.isFinite).sort((a,b)=>a-b);
      const next=boundaries.find(boundary=>boundary>minutes+.02)||boundaries[boundaries.length-1];
      const delayMinutes=Math.max(.25,next-minutes);
      return Math.min(delayMinutes*60000,2147483647);
    }

    function applyDaypart(daypart,transitionDuration){
      const previous=document.documentElement.dataset.daypart;
      const stage=document.querySelector(".ambient-stage");

      if(previous && previous!==daypart && stage){
        fadeCurrentStage(transitionDuration||defaultTransition);
      }

      document.documentElement.dataset.daypart=daypart;
      document.body.dataset.daypart=daypart;
    }

    function applySunTimes(times,transitionDuration){
      const clock=localClock(new Date());
      const daypart=daypartFor(clock.minutes,times);
      const daylightProgress=Math.max(0,Math.min(1,(clock.minutes-times.sunrise)/(times.sunset-times.sunrise||1)));
      const solarHeight=Math.sin(Math.PI*daylightProgress);

      applyDaypart(daypart,transitionDuration);
      document.body.style.setProperty("--solar-x",(10+80*daylightProgress).toFixed(2)+"%");
      document.body.style.setProperty("--solar-y",(62-47*solarHeight).toFixed(2)+"%");
      document.body.dataset.sunrise=Math.round(times.sunrise);
      document.body.dataset.sunset=Math.round(times.sunset);
      document.body.dataset.sunSource=times.source||"unknown";
      applyThemeMeta();
      scheduleNextUpdate(times);
    }

    function scheduleNextUpdate(times){
      if(scheduleTimer)clearTimeout(scheduleTimer);
      const clock=localClock(new Date());
      scheduleTimer=setTimeout(()=>{
        syncThemeBackground(defaultTransition);
      },nextBoundaryDelay(clock.minutes,times));
    }

    async function syncThemeBackground(transitionDuration){
      const forced=forcedDaypart();
      if(forced){
        if(scheduleTimer)clearTimeout(scheduleTimer);
        applyDaypart(forced,transitionDuration);
        document.body.dataset.sunSource="admin";
        applyThemeMeta();
        return;
      }

      const clock=localClock(new Date());
      const cached=readCachedSunTimes(clock.dateKey);
      const fallback=fallbackSunTimes(clock.month,clock.dateKey);

      currentTimes=cached||(currentTimes&&currentTimes.dateKey===clock.dateKey?currentTimes:null)||fallback;
      applySunTimes(currentTimes,transitionDuration);

      if(!cached){
        try{
          currentTimes=await fetchSunTimes(clock.dateKey);
          applySunTimes(currentTimes,transitionDuration);
        }catch(error){
          currentTimes=fallback;
          applySunTimes(currentTimes,transitionDuration);
        }
      }
    }

    syncThemeBackground(resumeTransition);

    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden){
        syncRemoteTheme({transitionDuration:resumeTransition});
        syncThemeBackground(resumeTransition);
      }
    });

    window.addEventListener("pageshow",()=>{
      syncRemoteTheme({transitionDuration:resumeTransition,force:true});
      syncThemeBackground(resumeTransition);
    });
  }

  window.AppLayout=Object.freeze({
    themeStorageKey,
    themeConfigUrl,
    get theme(){
      return activeTheme;
    },
    setLocalTheme(themeName){
      return setActiveTheme(themeName,{transitionDuration:1000,persist:true});
    },
    syncRemoteTheme,
    goBack
  });
  window.goBack=goBack;

  window.addEventListener("DOMContentLoaded",()=>{
    document.body.dataset.theme=activeTheme;
    initializeThemeBackground();
    syncRemoteTheme({transitionDuration:1000,force:true});
  });
})();
