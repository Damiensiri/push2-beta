(function initializeAppLayout(){
  const config=window.APP_CONFIG || {};
  const themes=Array.isArray(config.themes)?config.themes:["summer"];
  const theme=themes.includes(config.theme)?config.theme:"summer";
  const sunCachePrefix="ecurie-theme-sun-v2:";
  const latitude=48.391;
  const longitude=4.527;
  const timeZone="Europe/Paris";

  document.documentElement.dataset.theme=theme;

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
        const style=getComputedStyle(stage);
        const fade=document.createElement("div");
        const existing=stage.querySelector(".daypart-fade");

        if(existing)existing.remove();

        fade.className="daypart-fade";
        fade.setAttribute("aria-hidden","true");
        fade.style.setProperty("--daypart-transition-duration",(transitionDuration||defaultTransition)+"ms");
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
        },(transitionDuration||defaultTransition)+1200);
      }

      document.documentElement.dataset.daypart=daypart;
      document.body.dataset.daypart=daypart;
    }

    function applyThemeMeta(){
      const themeMeta=document.querySelector('meta[name="theme-color"]');
      const themeColor=getComputedStyle(document.body)
        .getPropertyValue("--browser-theme-color")
        .trim();

      if(themeMeta && themeColor)themeMeta.setAttribute("content",themeColor);
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
      if(!document.hidden)syncThemeBackground(resumeTransition);
    });

    window.addEventListener("pageshow",()=>{
      syncThemeBackground(resumeTransition);
    });
  }

  window.AppLayout=Object.freeze({
    theme,
    goBack
  });
  window.goBack=goBack;

  window.addEventListener("DOMContentLoaded",()=>{
    document.body.dataset.theme=theme;
    initializeThemeBackground();
  });
})();
