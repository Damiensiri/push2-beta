const SHEET_URL="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/statuses";
const FRESHNESS=60000;
const CACHE_KEY="statuts";
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at";

const PADDOCK_ICONS={
"maison":"image/paddock-maison.svg",
"grande-voie":"image/paddock-grande-voie.svg",
"beudot":"image/paddock-beudot.svg"
};

const SPACE_ICONS={
"carriere":"image/travail.svg",
"manege":"image/travail.svg",
...PADDOCK_ICONS
};

const STATUS_LABELS={
"ouvert":"Ouvert",
"prevision":"Prévu",
"ferme":"Fermé",
"hors-service":"Hors service"
};

let DATA=[];
let syncPending=false;
let backgroundedAt=null;

const mapWrapper=document.getElementById("mapWrapper");
const panel=document.getElementById("panel");
const panelTitle=document.getElementById("panelTitle");
const statut=document.getElementById("statut");
const horaire=document.getElementById("horaire");
const info=document.getElementById("info");
const liberte=document.getElementById("liberte");
const longe=document.getElementById("longe");
const optionsRow=document.getElementById("optionsRow");
const reserveBox=document.getElementById("reserveBox");
const closePanel=document.getElementById("closePanel");
const haloCircle=document.getElementById("haloCircle");
const panelIconImg=document.getElementById("panelIconImg");

function setPanelIcon(espace){
panelIconImg.src=SPACE_ICONS[espace]||"image/paddock.svg";
}

function formatStatusTime(value){
const match=String(value||"").match(/^(\d{2}):(\d{2})$/);
return match?`${match[1]}h${match[2]}`:"";
}

function transitionText(transition){
if(!transition||!transition.type||!transition.time) return "";
const time=formatStatusTime(transition.time);
if(!time) return "";
const offset=Number(transition.dayOffset)||0;
let day="";
if(offset===1) day=" demain";
else if(offset>1){
const date=new Date();
date.setDate(date.getDate()+offset);
day=" "+date.toLocaleDateString("fr-FR",{weekday:"long"});
}
return transition.type==="closing"?`Fermeture${day} à ${time}`:`Ouverture${day} à ${time}`;
}

function loadData(){
fetch(SHEET_URL+"?t="+Date.now(),{cache:"no-store"})
.then(r=>{
if(!r.ok) throw new Error("Réponse réseau invalide");
return r.json();
})
.then(d=>{
DATA=d;
localStorage.setItem(CACHE_KEY,JSON.stringify(d));
localStorage.setItem(CACHE_CONFIRMED_AT_KEY,String(Date.now()));
renderIcons(d);
if(syncPending) confirmSync();
})
.catch(()=>{
if(syncPending) setSyncState("waiting");
});
}

function setSyncState(state){
mapWrapper.classList.toggle("is-syncing",state==="syncing");
mapWrapper.classList.toggle("is-sync-waiting",state==="waiting");
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
const cached=localStorage.getItem(CACHE_KEY);
const confirmedAt=Number(localStorage.getItem(CACHE_CONFIRMED_AT_KEY));
return Boolean(cached) &&
Number.isFinite(confirmedAt) &&
Date.now()-confirmedAt<FRESHNESS;
}catch(e){
return false;
}
}

function renderIcons(data){
data.forEach(e=>{
const icon=SPACE_ICONS[e.espace];
const el=document.getElementById("icon-"+e.espace);
const button=el&&el.closest(".plan-btn");
if(el&&icon) el.src=icon;
if(button) button.dataset.status=(e.statut_auto||"").toLowerCase().trim();
});
}

const cache=localStorage.getItem(CACHE_KEY);

if(cache){
try{
DATA=JSON.parse(cache);
renderIcons(DATA);
}catch(e){}
}

if(!cacheIsFresh()) requireSync();

loadData();
setInterval(loadData,10000);

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
loadData();
}

});

window.addEventListener("online",()=>{
if(syncPending) loadData();
});

function openSpace(espace){

setPanelIcon(espace);

const e=DATA.find(x=>x.espace===espace);
if(!e) return;

panelTitle.innerText=formatTitle(e.espace);

function formatTitle(t){

const map={
"carriere":"Carrière",
"manege":"Manège",
"maison":"Maison",
"grande-voie":"Grande voie",
"beudot":"Beudot"
};

return map[t]||t;

}

const status=(e.statut_auto||"").toLowerCase().trim();
const manualStatus=(e.statut_manuel||"").toLowerCase().trim();
const statusColors={"ouvert":"#33d17a","prevision":"#ffb23f","ferme":"#ff4d4d","hors-service":"#d6dde8"};
statut.innerText=STATUS_LABELS[status]||"---";
statut.style.color=statusColors[status]||"";

horaire.innerText=manualStatus==="prevision"?(e.horaire_special||""):transitionText(e.transition);
horaire.hidden=!horaire.innerText;

info.innerText=e.info||"Aucune info";

/* couleur halo */

let color=statusColors[status]||"#33d17a";

haloCircle.style.stroke=color;

/* animation halo */

haloCircle.style.transition="none";
haloCircle.style.strokeDashoffset="188";

setTimeout(()=>{
haloCircle.style.transition="stroke-dashoffset 0.9s ease";
haloCircle.style.strokeDashoffset="0";
},50);

/* options */

let show=false;

if(e.liberte){
liberte.innerHTML=`Liberté : <span style="color:${e.liberte==="oui"?"#33d17a":"#ff4d4d"};font-weight:800">${e.liberte.toUpperCase()}</span>`;
show=true;
}

if(e.longe){
longe.innerHTML=`Longe : <span style="color:${e.longe==="oui"?"#33d17a":"#ff4d4d"};font-weight:800">${e.longe.toUpperCase()}</span>`;
show=true;
}

optionsRow.style.display=show?"block":"none";

/* réservation */

if((espace==="maison"||espace==="grande-voie"||espace==="beudot") &&
(e.statut_auto==="ouvert"||e.statut_auto==="prevision")){
reserveBox.style.display="block";
}else{
reserveBox.style.display="none";
}

panel.classList.add("active");

}

closePanel.onclick=()=>panel.classList.remove("active");

function goReserve(){
location.href="planningpaddock.html";
}

window.addEventListener("pwa-data-changed",loadData);
