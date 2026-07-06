/* PANIER */

let cart = JSON.parse(localStorage.getItem("cart") || "[]")

const checkoutForm=document.getElementById("checkoutForm")
const clientNom=document.getElementById("clientNom")
const clientPrenom=document.getElementById("clientPrenom")
const clientEmail=document.getElementById("clientEmail")
const commanderBtn=document.getElementById("commanderBtn")
const customerFields=[clientNom,clientPrenom,clientEmail]

function updateCommanderState(){
const fieldsComplete=customerFields.every(field=>field.value.trim()!=="")
const emailValid=clientEmail.checkValidity()
commanderBtn.disabled=cart.length===0 || !fieldsComplete || !emailValid
}

customerFields.forEach(field=>{
field.addEventListener("input",updateCommanderState)
})

checkoutForm.addEventListener("submit",event=>{
event.preventDefault()
commander()
})

function render(){

let html=""
let total=0

cart.forEach(item=>{

html+=`
<div class="item">
<div>${item.name} x${item.qty}</div>
<div>${item.price*item.qty} €</div>
</div>
`

total+=item.price*item.qty

})

document.getElementById("cartList").innerHTML=html
document.getElementById("total").innerText=total
updateCommanderState()

}

render()

/* VIDER PANIER */

function vider(){

localStorage.removeItem("cart")
cart=[]
render()

}

/* COMMANDER */

function commander(){

if(cart.length===0){
alert("Panier vide")
return
}

let nom = clientNom.value.trim()
let prenom = clientPrenom.value.trim()
let email = clientEmail.value.trim()

if(!nom || !prenom || !email || !clientEmail.checkValidity()){
checkoutForm.reportValidity()
updateCommanderState()
return
}

commanderBtn.disabled=true

let total=0
let commandeText=""

cart.forEach(item=>{

let lineTotal=item.price*item.qty

commandeText+=`${item.name} x${item.qty} = ${lineTotal} €\n`

total+=lineTotal

})

let orderId=Date.now()
let dateISO=new Date().toISOString()

if(window.AppMailer){
window.AppMailer.sendOrderConfirmation({
source:"panier",
orderId,
customer:{lastName:nom,firstName:prenom,email},
total,
items:cart.map(item=>({
name:item.name,
quantity:item.qty,
lineTotal:item.price*item.qty
}))
}).catch(error=>{
console.warn("Confirmation Apps Script non envoyée",error)
})
}

let orders = JSON.parse(localStorage.getItem("orders") || "[]")

orders.push({
id:orderId,
date:new Date().toLocaleString(),
items:[...cart],
total:total
})

localStorage.setItem("orders", JSON.stringify(orders))
localStorage.setItem("lastOrder", JSON.stringify({items:cart,total:total}))

fetch("https://docs.google.com/forms/d/e/1FAIpQLSd7FyCadHVREHz5A_Y3tGIANItJppc-xx2hEtopxd90lU50Hw/formResponse",{
method:"POST",
mode:"no-cors",
keepalive:true,
body:new URLSearchParams({
"entry.1196863567":nom,
"entry.1084486832":prenom,
"entry.322695866":email,
"entry.1740027870":commandeText,
"entry.99574245":total,
"entry.1184215130":orderId,
"entry.489600561":dateISO,
"entry.1098731878":"En attente",
"entry.484692587":""
})
}).catch(error=>{
console.warn("Enregistrement Google de la commande indisponible",error)
})

localStorage.removeItem("cart")

window.location.href="confirmation.html"

}
