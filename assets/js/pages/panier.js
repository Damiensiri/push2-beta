/* EMAILJS */

(function(){
try{
if(window.emailjs) emailjs.init("03cdce-AcdCC03k_v");
}catch(error){
console.warn("Initialisation EmailJS indisponible",error);
}
})();

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
let commandeHTML=""

cart.forEach(item=>{

let lineTotal=item.price*item.qty

commandeHTML+=`
<tr>
<td>${item.name}</td>
<td align="center">${item.qty}</td>
<td align="right">${lineTotal} €</td>
</tr>
`

total+=lineTotal

})

try{
Promise.resolve(emailjs.send("service_mkpsbdf","template_ftv15rb",{

nom:nom,
prenom:prenom,
email:email,
commande:commandeHTML,
total:total

})).catch(error=>{
console.warn("Confirmation EmailJS non envoyée",error)
})
}catch(error){
console.warn("Confirmation EmailJS indisponible",error)
}

let orders = JSON.parse(localStorage.getItem("orders") || "[]")

orders.push({
date:new Date().toLocaleString(),
items:cart,
total:total
})

localStorage.setItem("orders", JSON.stringify(orders))
localStorage.setItem("lastOrder", JSON.stringify({items:cart,total:total}))

localStorage.removeItem("cart")

window.location.href="confirmation.html"

}
