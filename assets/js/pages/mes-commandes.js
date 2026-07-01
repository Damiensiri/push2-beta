/* SHEET */
const SHEET_URL = "https://opensheet.elk.sh/1ka6djXZhsDBbF77OVgH5wjqQwLpMUUPbMl1RD_rssXI/Réponses%20au%20formulaire%201"

/* LOAD */
let orders = JSON.parse(localStorage.getItem("orders") || "[]")
orders = purgeOldOrders(orders)

function purgeOldOrders(list){
const limit = new Date()
limit.setMonth(limit.getMonth()-6)

const filtered = list.filter(order=>{
const d = parseOrderDate(order.date)
return !d || d >= limit
})

if(filtered.length !== list.length){
localStorage.setItem("orders", JSON.stringify(filtered))
}

return filtered
}

function parseOrderDate(value){
if(!value) return null

const d = new Date(value)
if(!isNaN(d)) return d

const match = String(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
if(!match) return null

return new Date(
Number(match[3]),
Number(match[2])-1,
Number(match[1]),
Number(match[4]||0),
Number(match[5]||0),
Number(match[6]||0)
)
}

fetch(SHEET_URL)
.then(r=>r.json())
.then(sheetData=>{

let html=""

if(orders.length === 0){

html=`<div class="empty">Aucune commande pour le moment.</div>`

}else{

orders.reverse().forEach(order=>{

let items=""

order.items.forEach(i=>{
items+=`
<div class="item">
<div>${i.name} x${i.qty}</div>
<div>${i.price*i.qty} €</div>
</div>
`
})

/* MATCH PAR ID */
let statut = "En attente"
let commentaire = ""

let found = sheetData.find(s=>{
return String(s["ID"]) === String(order.id)
})

if(found){
statut = found["Statut"] || "En attente"
commentaire = found["Commentaire"] || ""
}
/* COULEUR */
let color="#aaa"
if(statut==="Validée") color="#2ecc71"
if(statut==="Refusée") color="#e74c3c"
if(statut==="Prête") color="#f1c40f"

/* HTML */
html+=`
<div class="order">

<div class="date">${order.date}</div>

${items}

<div class="total">
Total : ${order.total} €
</div>

<div class="status" style="color:${color}">
Statut : ${statut}
</div>

${commentaire ? `
<div style="margin-top:10px;font-size:14px;opacity:.9">
<strong>Info :</strong> ${commentaire}
</div>
` : ""}

</div>
`

})

}

document.getElementById("orders").innerHTML=html

})
