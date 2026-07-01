const API="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=statuts";

const ESPACES=["maison","grande-voie","beudot"];

const ICONS={
"ouvert":"image/ouvert.png",
"ferme":"image/ferme.png",
"prevision":"image/prevision.png",
"hors-service":"image/horsservice.png"
};

let lastData="";

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

async function load(){

try{

const r=await fetch(API+"&t="+Date.now(),{cache:"no-store"});
const data=await r.json();

localStorage.setItem("statuts",JSON.stringify(data));

render(data);

}catch(e){
console.log("API error",e);
}

}

function goReserve(){
location.href="planningpaddock.html";
}

window.addEventListener("load",()=>{

/* affichage instantané depuis cache */

const cache=localStorage.getItem("statuts");
if(cache){
try{
render(JSON.parse(cache));
}catch(e){}
}

load();

setInterval(load,10000);

});
