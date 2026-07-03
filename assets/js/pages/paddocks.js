const API="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=statuts";
const FRESHNESS=60000;
const CACHE_KEY="statuts";
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at";

const ESPACES=["maison","grande-voie","beudot"];

const ICONS={
"ouvert":"image/ouvert.png",
"ferme":"image/ferme.png",
"prevision":"image/prevision.png",
"hors-service":"image/horsservice.png"
};

let lastData="";
let syncPending=false;
let backgroundedAt=null;

function render(data){

const signature=JSON.stringify(data);
if(signature===lastData) return;
lastData=signature;

let bouton=false;

ESPACES.forEach(e=>{

const row=data.find(x=>x.espace===e);
if(!row) return;

document.getElementById(e+"-statut").src=ICONS[row.statut_auto]||"";

const h=row.horaire_special||row.horaire_affiche||"";

const el=document.getElementById(e+"-horaire");

el.innerText=h;

if(row.horaire_special){
el.style.color="#E88B00";
el.style.fontWeight="600";
}else{
el.style.color="var(--text)";
el.style.fontWeight="400";
}

document.getElementById(e+"-info").innerText=row.info||"";

if(row.statut_auto==="ouvert"||row.statut_auto==="prevision"){
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

const r=await fetch(API+"&t="+Date.now(),{cache:"no-store"});
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
