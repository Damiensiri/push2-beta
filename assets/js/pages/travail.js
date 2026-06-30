const API_URL="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=statuts"
const REFRESH=10000

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

function loadData(){

fetch(API_URL+"&t="+Date.now(),{cache:"no-store"})
.then(r=>r.json())
.then(data=>{

localStorage.setItem("statuts",JSON.stringify(data))

render(data)

})

}

updateDate()

/* affichage instantané depuis cache */

const cache=localStorage.getItem("statuts")
if(cache){
try{
render(JSON.parse(cache))
}catch(e){}
}

loadData()
setInterval(loadData,REFRESH)
