(function initializeAppLayout(){
  const config=window.APP_CONFIG || {};
  const themes=Array.isArray(config.themes)?config.themes:["summer"];
  const theme=themes.includes(config.theme)?config.theme:"summer";

  document.documentElement.dataset.theme=theme;

  function goBack(){
    const page=document.getElementById("page");
    const usesBodySlide=document.body.dataset.pageTransition==="slide";
    const delay=usesBodySlide?350:300;

    if(usesBodySlide){
      document.body.classList.add("slide-out");
    }else if(page){
      page.classList.remove("active");
      page.classList.add("exit");
    }

    setTimeout(()=>{
      location.href="index.html";
    },delay);
  }

  function initializeSolarAmbiance(){
    const latitude=48.391;
    const longitude=4.527;
    const timeZone="Europe/Paris";
    const radians=Math.PI/180;

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
        timeZoneName:"shortOffset"
      }).formatToParts(date).forEach(part=>{
        if(part.type!=="literal")parts[part.type]=part.value;
      });

      const offsetMatch=(parts.timeZoneName||"GMT+1").match(/GMT([+-]?\d+(?::\d+)?)/);
      const offsetText=offsetMatch?offsetMatch[1]:"1";
      const offsetParts=offsetText.split(":");
      const offsetHours=Number(offsetParts[0])+(Number(offsetParts[1]||0)/60)*Math.sign(Number(offsetParts[0])||1);
      const dayStart=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day));
      const yearStart=Date.UTC(Number(parts.year),0,1);

      return{
        minutes:Number(parts.hour)*60+Number(parts.minute),
        dayOfYear:Math.floor((dayStart-yearStart)/86400000)+1,
        offsetHours
      };
    }

    function solarTimes(clock){
      const gamma=(2*Math.PI/365)*(clock.dayOfYear-1);
      const equationOfTime=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
      const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
      const zenith=90.833*radians;
      const hourAngle=Math.acos((Math.cos(zenith)/(Math.cos(latitude*radians)*Math.cos(declination)))-Math.tan(latitude*radians)*Math.tan(declination));
      const solarNoon=720-4*longitude-equationOfTime+clock.offsetHours*60;
      const daylightMinutes=(hourAngle/radians)*8;

      return{
        sunrise:solarNoon-daylightMinutes/2,
        noon:solarNoon,
        sunset:solarNoon+daylightMinutes/2
      };
    }

    function phaseFor(minutes,times){
      if(minutes<times.sunrise-55||minutes>=times.sunset+50)return"night";
      if(minutes<times.sunrise+35)return"dawn";
      if(minutes<times.noon-80)return"morning";
      if(minutes<times.sunset-115)return"day";
      if(minutes<times.sunset-25)return"golden";
      return"dusk";
    }

    function updateAmbiance(){
      const clock=localClock(new Date());
      const times=solarTimes(clock);
      const phase=phaseFor(clock.minutes,times);
      const daylightProgress=Math.max(0,Math.min(1,(clock.minutes-times.sunrise)/(times.sunset-times.sunrise)));
      const solarHeight=Math.sin(Math.PI*daylightProgress);

      document.documentElement.dataset.dayPhase=phase;
      document.body.dataset.dayPhase=phase;
      document.body.style.setProperty("--solar-x",(10+80*daylightProgress).toFixed(2)+"%");
      document.body.style.setProperty("--solar-y",(62-47*solarHeight).toFixed(2)+"%");
      document.body.dataset.sunrise=Math.round(times.sunrise);
      document.body.dataset.sunset=Math.round(times.sunset);

      const themeMeta=document.querySelector('meta[name="theme-color"]');
      const themeColor=getComputedStyle(document.body)
        .getPropertyValue("--browser-theme-color")
        .trim();

      if(themeMeta && themeColor)themeMeta.setAttribute("content",themeColor);
    }

    updateAmbiance();
    setInterval(updateAmbiance,60000);
  }

  window.AppLayout=Object.freeze({
    theme,
    goBack
  });
  window.goBack=goBack;

  window.addEventListener("DOMContentLoaded",()=>{
    document.body.dataset.theme=theme;
    initializeSolarAmbiance();
  });
})();
