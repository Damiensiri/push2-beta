const SHEET_URL="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/statuses";
const FRESHNESS=60000;
const CACHE_KEY="statuts";
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at";

const ICONS={
"ouvert":"image/ouvert.png",
"ferme":"image/ferme.png",
"prevision":"image/prevision.png",
"hors-service":"image/horsservice.png"
};

const PADDOCK_ICONS={
"maison":"image/paddock-maison.svg",
"grande-voie":"image/paddock-grande-voie.svg",
"beudot":"image/paddock-beudot.svg"
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
if(espace==="carriere" || espace==="manege"){
panelIconImg.src="image/travail.svg";
}else{
panelIconImg.src=PADDOCK_ICONS[espace]||"image/paddock.svg";
}
}

function loadData(){
fetch(SHEET_URL+"&t="+Date.now(),{cache:"no-store"})
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
const icon=ICONS[(e.statut_auto||"").toLowerCase().trim()];
const el=document.getElementById("icon-"+e.espace);
if(el && icon) el.src=icon;
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

if(e.statut_auto==="ouvert"){
statut.innerText="Ouvert";
statut.style.color="#33d17a";
}

if(e.statut_auto==="prevision"){
statut.innerText="Ouverture prévue";
statut.style.color="#ffb23f";
}

if(e.statut_auto==="ferme"){
statut.innerText="Fermé";
statut.style.color="#ff4d4d";
}

if(e.statut_auto==="hors-service"){
statut.innerText="Hors service";
statut.style.color="#d6dde8";
}
info.innerText=e.info||"Aucune info";

/* couleur halo */

let color="#33d17a";

if(e.statut_auto==="ferme") color="#ff4d4d";
if(e.statut_auto==="prevision") color="#ffb23f";
if(e.statut_auto==="hors-service") color="#d6dde8";

haloCircle.style.stroke=color;

/* animation halo */

haloCircle.style.transition="none";
haloCircle.style.strokeDashoffset="188";

setTimeout(()=>{
haloCircle.style.transition="stroke-dashoffset 0.9s ease";
haloCircle.style.strokeDashoffset="0";
},50);

/* horaires */

if(e.horaire_special && e.horaire_special.trim() !== ""){
horaire.innerHTML = `<span style="color:#ffb23f;font-weight:700">${e.horaire_special}</span>`;
}else{
horaire.innerText = e.horaire_affiche||"---";
}
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
