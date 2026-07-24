const API_URL="https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/statuses"
const REFRESH=10000
const FRESHNESS=60000
const CACHE_KEY="statuts"
const CACHE_CONFIRMED_AT_KEY="statuts_confirmed_at"

let syncPending=false
let backgroundedAt=null

const STATUS_LABELS={
"ouvert":"Ouvert",
"ferme":"Fermé",
"prevision":"Prévu",
"hors-service":"Hors service"
}

function formatStatusTime(value){
const match=String(value||"").match(/^(\d{2}):(\d{2})$/)
return match?`${match[1]}h${match[2]}`:""
}

function transitionText(transition){
if(!transition || !transition.type || !transition.time) return ""
const time=formatStatusTime(transition.time)
if(!time) return ""
const offset=Number(transition.dayOffset)||0
let day=""
if(offset===1) day=" demain"
else if(offset>1){
const date=new Date()
date.setDate(date.getDate()+offset)
day=" "+date.toLocaleDateString("fr-FR",{weekday:"long"})
}
return transition.type==="closing"?`Fermeture${day} à ${time}`:`Ouverture${day} à ${time}`
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
const statusWrap=document.getElementById(espace+"-statut").closest(".status-wrap")
statusWrap.className="status-wrap status-"+statut

document.getElementById(espace+"-statut").innerText=STATUS_LABELS[statut] || ""

const el=document.getElementById(espace+"-horaire")
el.innerText=(row.horaire_special || "").trim() || transitionText(row.transition)
el.hidden=!el.innerText

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

fetch(API_URL+"?t="+Date.now(),{cache:"no-store"})
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

window.addEventListener("pwa-data-changed",loadData)
