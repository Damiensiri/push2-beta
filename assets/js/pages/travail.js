const API_URL="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=statuts"
const REFRESH=10000
const FRESHNESS=60000
const CACHE_KEY="statuts"
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at"

let syncPending=false
let backgroundedAt=null

const ICONS_STATUT={
"ouvert":"image/ouvert.png",
"ferme":"image/ferme.png",
"prevision":"image/prevision.png",
"hors-service":"image/horsservice.png"
}

window.addEventListener("DOMContentLoaded",()=>{
requestAnimationFrame(()=>{
document.getElementById("page").classList.add("active")
})
})

function updateDate(){

const j=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"]
const m=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"]

const d=new Date()

document.getElementById("date").innerText=
j[d.getDay()]+" "+d.getDate()+" "+m[d.getMonth()]+" "+d.getFullYear()

}

function makeBadge(val){

if(!val) return ""

val=val.toLowerCase().trim()

if(val==="oui") return `<span class="badge oui">OUI</span>`
if(val==="non") return `<span class="badge non">NON</span>`

return ""

}

function render(data){

["carriere","manege"].forEach(espace=>{

const row=data.find(e=>e.espace===espace)

if(!row) return

document.getElementById(espace+"-liberte").innerHTML=
makeBadge(row.liberte)

document.getElementById(espace+"-longe").innerHTML=
makeBadge(row.longe)

const statut=(row.statut_auto || "").toLowerCase().trim()

document.getElementById(espace+"-statut").src=
ICONS_STATUT[statut] || ""

const horaire=row.horaire_special || row.horaire_affiche || ""

const el=document.getElementById(espace+"-horaire")

el.innerText=horaire

if(row.horaire_special){

el.style.color="#E88B00"
el.style.fontWeight="600"

}else{

el.style.color="var(--text)"
el.style.fontWeight="400"

}

document.getElementById(espace+"-info").innerText=row.info || ""

})

}

function getSyncCards(){

return document.querySelectorAll(".card")

}

function setSyncState(state){

getSyncCards().forEach(card=>{
card.classList.toggle("is-syncing",state==="syncing")
card.classList.toggle("is-sync-waiting",state==="waiting")
})

}

function requireSync(){

syncPending=true
setSyncState("syncing")

}

function confirmSync(){

syncPending=false
setSyncState("")

}

function cacheIsFresh(){

try{
const cached=localStorage.getItem(CACHE_KEY)
const confirmedAt=Number(localStorage.getItem(CACHE_CONFIRMED_AT_KEY))
return Boolean(cached) &&
Number.isFinite(confirmedAt) &&
Date.now()-confirmedAt<FRESHNESS
}catch(e){
return false
}

}

function loadData(){

fetch(API_URL+"&t="+Date.now(),{cache:"no-store"})
.then(r=>{
if(!r.ok) throw new Error("Réponse réseau invalide")
return r.json()
})
.then(data=>{

localStorage.setItem(CACHE_KEY,JSON.stringify(data))
localStorage.setItem(CACHE_CONFIRMED_AT_KEY,String(Date.now()))

render(data)

if(syncPending) confirmSync()

})
.catch(()=>{

if(syncPending) setSyncState("waiting")

})

}

updateDate()

/* affichage instantané depuis cache */

const cache=localStorage.getItem(CACHE_KEY)
if(cache){
try{
render(JSON.parse(cache))
}catch(e){}
}

if(!cacheIsFresh()) requireSync()

loadData()
setInterval(loadData,REFRESH)

document.addEventListener("visibilitychange",()=>{

if(document.visibilityState==="hidden"){
backgroundedAt=Date.now()
return
}

if(backgroundedAt===null) return

const timeAway=Date.now()-backgroundedAt
backgroundedAt=null

if(timeAway>=FRESHNESS && !cacheIsFresh()){
requireSync()
loadData()
}

})

window.addEventListener("online",()=>{

if(syncPending) loadData()

})
