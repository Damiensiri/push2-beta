/* ===== CONFIG ===== */

const SHEET_URL="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/schedules";
const EXCEPTIONS_URL="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/exceptions";

const REFRESH=60000;
const FRESHNESS=60000;
const CACHE_KEY="horaires";
const EXCEPTIONS_CACHE_KEY="horaires_exceptions";
const CACHE_CONFIRMED_AT_KEY="horaires_confirmed_at";

let exceptions={};
let syncPending=false;
let syncState="";
let backgroundedAt=null;

/* ===== FORMAT JOUR ===== */

function capitalize(txt){
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* ===== FORMAT HEURE ===== */

function formatTime(val){

  if(!val) return "--:--";

  let d=new Date(val);

  if(!isNaN(d)){
    return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  }

  return String(val).substring(0,5);

}

function rollingDates(date=new Date()){
  const parts={};
  new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date).forEach(part=>{
    if(part.type!=="literal") parts[part.type]=part.value;
  });
  const current=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),12));
  const names=["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
  const todayIndex=(current.getUTCDay()+6)%7;
  const dates={};
  names.forEach((name,index)=>{
    const day=new Date(current);
    const offset=(index-todayIndex+7)%7;
    day.setUTCDate(current.getUTCDate()+offset);
    dates[day.toISOString().slice(0,10)]=name;
  });
  return dates;
}

function applyExceptions(data,date=new Date()){
  exceptions={};
  const weekDates=rollingDates(date);

  data.forEach(row=>{
    const jour=weekDates[String(row.date||"")];
    if(jour) exceptions[jour]=row.message;
  });
}

/* ===== RENDER ===== */

function renderHoraires(data){

  const list=document.getElementById("list");
  list.innerHTML="";

  data.forEach(row=>{

    if(!row.jour) return;

    const card=document.createElement("div");
    card.className="card";

    let contenu;

    if(exceptions[row.jour]){
      contenu=exceptions[row.jour];
    }else if(row.statut==="ferme"){
      contenu="Fermé";
    }else if(row.statut==="hors-service"){
      contenu="Hors service";
    }else{
      const partialClosures=(row.closedIntervals||[])
        .filter(item=>item.open&&item.close)
        .map(item=>`Fermé ${formatTime(item.open)} - ${formatTime(item.close)}`);
      contenu=`${formatTime(row.ouvert)} - ${formatTime(row.ferme)}${
        partialClosures.length?`<small class="partial-closure">${partialClosures.join(" · ")}</small>`:""
      }`;
    }

    card.innerHTML=`
      <img src="image/time.svg">
      <div class="day">${capitalize(row.jour)} :</div>
      <div class="time">${contenu}</div>
    `;

    list.appendChild(card);

  });

  if(syncPending) setSyncState(syncState);

}

/* ===== SYNCHRONISATION ===== */

function getSyncCards(){
  return document.querySelectorAll(".card");
}

function setSyncState(state){
  syncState=state;
  getSyncCards().forEach(card=>{
    card.classList.toggle("is-syncing",state==="syncing");
    card.classList.toggle("is-sync-waiting",state==="waiting");
  });
}

function requireSync(){
  syncPending=true;
  setSyncState("syncing");
}

function confirmSync(){
  syncPending=false;
  setSyncState("");
}

function cacheIsFresh(){
  try{
    const cachedHoraires=localStorage.getItem(CACHE_KEY);
    const cachedExceptions=localStorage.getItem(EXCEPTIONS_CACHE_KEY);
    const confirmedAt=Number(localStorage.getItem(CACHE_CONFIRMED_AT_KEY));
    return Boolean(cachedHoraires) &&
      Boolean(cachedExceptions) &&
      Number.isFinite(confirmedAt) &&
      Date.now()-confirmedAt<FRESHNESS;
  }catch(e){
    return false;
  }
}

function fetchJson(url){
  const separator=url.includes("?")?"&":"?";
  return fetch(url,{cache:"default"}).then(response=>{
    if(!response.ok) throw new Error("Réponse réseau invalide");
    return response.json();
  });
}

/* ===== LOAD ===== */

function loadHoraires(){

const weekDates=rollingDates();
const scheduleUrl=SHEET_URL+"?dates="+encodeURIComponent(Object.keys(weekDates).join(","));

Promise.all([
fetchJson(scheduleUrl),
fetchJson(EXCEPTIONS_URL)
])
.then(([horaires,exc])=>{

  applyExceptions(exc);

  try{
    localStorage.setItem(CACHE_KEY,JSON.stringify(horaires));
    localStorage.setItem(EXCEPTIONS_CACHE_KEY,JSON.stringify(exc));
    localStorage.setItem(CACHE_CONFIRMED_AT_KEY,String(Date.now()));
  }catch(e){}

  renderHoraires(resolveWeeklyHoraires(horaires,weekDates));

  if(syncPending) confirmSync();

})
.catch(()=>{
  if(syncPending) setSyncState("waiting");
});

}

function resolveWeeklyHoraires(payload,weekDates){
  if(Array.isArray(payload))return payload;
  return Object.entries(weekDates).map(([date,jour])=>{
    const rows=payload?.[date]||[];
    return rows.find(row=>row.jour===jour)||{jour,ouvert:"",ferme:""};
  });
}

/* ===== CACHE INSTANT ===== */

try{
  const cachedExceptions=localStorage.getItem(EXCEPTIONS_CACHE_KEY);
  if(cachedExceptions) applyExceptions(JSON.parse(cachedExceptions));

  const cachedHoraires=localStorage.getItem(CACHE_KEY);
  if(cachedHoraires) renderHoraires(resolveWeeklyHoraires(JSON.parse(cachedHoraires),rollingDates()));
}catch(e){}

if(!cacheIsFresh()) requireSync();

/* ===== REFRESH ===== */

loadHoraires();
setInterval(loadHoraires,REFRESH);

document.addEventListener("visibilitychange",()=>{

  if(document.visibilityState==="hidden"){
    backgroundedAt=Date.now();
    return;
  }

  if(backgroundedAt===null) return;

  const timeAway=Date.now()-backgroundedAt;
  backgroundedAt=null;

  if(timeAway>=FRESHNESS && !cacheIsFresh()){
    requireSync();
    loadHoraires();
  }

});

window.addEventListener("online",()=>{
  if(syncPending) loadHoraires();
});

window.addEventListener("pwa-data-changed",loadHoraires);
