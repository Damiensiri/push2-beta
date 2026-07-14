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

function applyExceptions(data){
  exceptions={};

  data.forEach(row=>{
    if(row.date){
      const d=new Date(row.date);
      const jour=d.toLocaleDateString("fr-FR",{weekday:"long"}).toLowerCase();
      exceptions[jour]=row.message;
    }
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
    }else{
      contenu=`${formatTime(row.ouvert)} - ${formatTime(row.ferme)}`;
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
  return fetch(url+"?t="+Date.now(),{cache:"no-store"}).then(response=>{
    if(!response.ok) throw new Error("Réponse réseau invalide");
    return response.json();
  });
}

/* ===== LOAD ===== */

function loadHoraires(){

Promise.all([
fetchJson(SHEET_URL),
fetchJson(EXCEPTIONS_URL)
])
.then(([horaires,exc])=>{

  applyExceptions(exc);

  try{
    localStorage.setItem(CACHE_KEY,JSON.stringify(horaires));
    localStorage.setItem(EXCEPTIONS_CACHE_KEY,JSON.stringify(exc));
    localStorage.setItem(CACHE_CONFIRMED_AT_KEY,String(Date.now()));
  }catch(e){}

  renderHoraires(horaires);

  if(syncPending) confirmSync();

})
.catch(()=>{
  if(syncPending) setSyncState("waiting");
});

}

/* ===== CACHE INSTANT ===== */

try{
  const cachedExceptions=localStorage.getItem(EXCEPTIONS_CACHE_KEY);
  if(cachedExceptions) applyExceptions(JSON.parse(cachedExceptions));

  const cachedHoraires=localStorage.getItem(CACHE_KEY);
  if(cachedHoraires) renderHoraires(JSON.parse(cachedHoraires));
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
