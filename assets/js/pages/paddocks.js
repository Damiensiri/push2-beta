const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/statuses";
const FRESHNESS=60000;
const CACHE_KEY="statuts";
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at";

const ESPACES=["maison","grande-voie","beudot"];

const STATUS_LABELS={
"ouvert":"Ouvert",
"ferme":"Fermé",
"prevision":"Prévu",
"hors-service":"Hors service"
};

let lastData="";
let syncPending=false;
let backgroundedAt=null;

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

function render(data){

const signature=JSON.stringify(data);
if(signature===lastData) return;
lastData=signature;

let bouton=false;

ESPACES.forEach(e=>{

const row=data.find(x=>x.espace===e);
if(!row) return;

const statut=(row.statut_auto||"").toLowerCase().trim();
const manualStatus=(row.statut_manuel||"").toLowerCase().trim();
const statusWrap=document.getElementById(e+"-statut").closest(".status-wrap");
statusWrap.className="status-wrap status-"+statut;

document.getElementById(e+"-statut").innerText=STATUS_LABELS[statut]||"";
const el=document.getElementById(e+"-horaire");
el.innerText=manualStatus==="prevision"?(row.horaire_special||""):transitionText(row.transition);
el.hidden=!el.innerText;

document.getElementById(e+"-info").innerText=row.info||"";

if(statut==="ouvert"||statut==="prevision"){
bouton=true;
}

});

document.getElementById("reserveBox").style.display=bouton?"flex":"none";

}

function getSyncCards(){
return document.querySelectorAll(".card");
}

function setSyncState(state){
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
const cached=localStorage.getItem(CACHE_KEY);
const confirmedAt=Number(localStorage.getItem(CACHE_CONFIRMED_AT_KEY));
return Boolean(cached) &&
Number.isFinite(confirmedAt) &&
Date.now()-confirmedAt<FRESHNESS;
}catch(e){
return false;
}
}

async function load(){

try{

const r=await fetch(API+"?t="+Date.now(),{cache:"no-store"});
if(!r.ok) throw new Error("Réponse réseau invalide");
const data=await r.json();

localStorage.setItem(CACHE_KEY,JSON.stringify(data));
localStorage.setItem(CACHE_CONFIRMED_AT_KEY,String(Date.now()));

render(data);

if(syncPending) confirmSync();

}catch(e){
console.log("API error",e);
if(syncPending) setSyncState("waiting");
}

}

function goReserve(){
location.href="planningpaddock.html";
}

window.addEventListener("load",()=>{

/* affichage instantané depuis cache */

const cache=localStorage.getItem(CACHE_KEY);
if(cache){
try{
render(JSON.parse(cache));
}catch(e){}
}

if(!cacheIsFresh()) requireSync();

load();

setInterval(load,10000);

});

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
load();
}

});

window.addEventListener("online",()=>{
if(syncPending) load();
});

window.addEventListener("pwa-data-changed",load);
