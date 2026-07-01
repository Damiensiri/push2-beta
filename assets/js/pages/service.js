emailjs.init("03cdce-AcdCC03k_v")

const SHEET_URL="https://opensheet.elk.sh/1ka6djXZhsDBbF77OVgH5wjqQwLpMUUPbMl1RD_rssXI/service"

let cart = JSON.parse(localStorage.getItem("cart") || "[]")
let products=[]

fetch(SHEET_URL)
.then(r=>r.json())
.then(data=>{
products=data.filter(p=>p.actif==="TRUE").sort((a,b)=>Number(a.rang)-Number(b.rang))
render()
updateCart()
})

function render(){

products.forEach(p=>{

if(p.featured==="TRUE"){

document.getElementById("featured").innerHTML=`
<img src="${p.image}">
<div id="featuredContent">
<h2>${p.nom}</h2>
<p>${p.description}</p>
<b>${p.prix} €</b>
<br><br>
<button class="addBtn" data-name="${encodeURIComponent(p.nom)}" data-price="${p.prix}">Ajouter</button>
</div>
`

}else{

let card=document.createElement("div")
card.className="card"

card.innerHTML=`
<div class="imgBox">
<img src="${p.image}">
${p.badge?`<div class="badge">${p.badge}</div>`:""}
</div>
<div class="content">
<div class="title">${p.nom}</div>
<div class="desc">${p.description}</div>
<div class="bottom">
<div class="price">${p.prix} €</div>
<button class="addBtn" data-name="${encodeURIComponent(p.nom)}" data-price="${p.prix}">Ajouter</button>
</div>
</div>
`

document.getElementById("products").appendChild(card)

}

})

}

/* CLICK GLOBAL (FIX BOUTON) */
document.addEventListener("click", function(e){
if(e.target.classList.contains("addBtn")){
let btn = e.target
let name = decodeURIComponent(btn.dataset.name)
let price = Number(btn.dataset.price)
addCart(name, price, btn)
}
})

/* AJOUT PANIER */
function addCart(name,price,btn){

let original=btn.innerText
btn.innerText="✓ Ajouté"
setTimeout(()=>btn.innerText=original,1000)

let img = btn.closest(".card, #featuredContent")?.querySelector("img")

if(img){
let rect = img.getBoundingClientRect()
let cartRect = document.getElementById("cartBtn").getBoundingClientRect()

let fly = img.cloneNode(true)
fly.classList.add("flyImg")

fly.style.left = rect.left+"px"
fly.style.top = rect.top+"px"
fly.style.width = rect.width+"px"
fly.style.height = rect.height+"px"

document.body.appendChild(fly)

setTimeout(()=>{
fly.style.left = cartRect.left+"px"
fly.style.top = cartRect.top+"px"
fly.style.width = "20px"
fly.style.height = "20px"
fly.style.opacity="0.3"
},10)

setTimeout(()=>fly.remove(),700)
}

let item=cart.find(i=>i.name===name)
if(item){item.qty++}else{cart.push({name,price,qty:1})}

updateCart()

let cartBtn=document.getElementById("cartBtn")
cartBtn.classList.add("pulse")
setTimeout(()=>cartBtn.classList.remove("pulse"),400)
}

/* PANIER */
function updateCart(){
localStorage.setItem("cart", JSON.stringify(cart))

let count=cart.reduce((a,b)=>a+b.qty,0)
document.getElementById("count").innerText=count

let html=""
let total=0

cart.forEach((item,i)=>{
html+=`
<div class="cartItem">
<div>${item.name}<br>${item.price}€</div>
<div class="qty">
<button onclick="changeQty(${i},-1)">-</button>
${item.qty}
<button onclick="changeQty(${i},1)">+</button>
</div>
</div>
`
total+=item.price*item.qty
})

document.getElementById("cartItems").innerHTML=html
document.getElementById("total").innerText=total
}

function changeQty(i,v){
cart[i].qty+=v
if(cart[i].qty<=0){cart.splice(i,1)}
updateCart()
}

function toggleCart(){
document.getElementById("cartPanel").classList.toggle("open")
}

/* CHECKOUT */
function checkout(){

let nom=clientNom.value.trim()
let prenom=clientPrenom.value.trim()
let email=clientEmail.value.trim()

if(!nom || !prenom || !email){
alert("Veuillez remplir Nom, Prénom et Email")
return
}

let commande=""
let total=0

cart.forEach(item=>{

let lineTotal=item.price*item.qty

commande += `${item.name} x${item.qty} = ${lineTotal} €\n`

total += lineTotal

})

emailjs.send("service_mkpsbdf","template_ftv15rb",{
nom,
prenom,
email,
commande,
total
})
.then(()=>{

let orderId = Date.now()
let dateISO = new Date().toISOString()

let commandeText = commande

/* 🔥 AJOUT ICI (LOCAL STORAGE) */
let orders = JSON.parse(localStorage.getItem("orders") || "[]")

orders.push({
id:orderId,
date:new Date().toLocaleString(),
items:[...cart],
total:total
})

localStorage.setItem("orders", JSON.stringify(orders))

/* GOOGLE FORM */
fetch("https://docs.google.com/forms/d/e/1FAIpQLSd7FyCadHVREHz5A_Y3tGIANItJppc-xx2hEtopxd90lU50Hw/formResponse",{
method:"POST",
mode:"no-cors",
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
})
cart = []
updateCart()
setTimeout(()=>{
  
window.location.href="mes-commandes.html"
},700)

})
}

/* SCROLL */
const featured=document.getElementById("featured")

window.addEventListener("scroll",()=>{
if(!featured) return

let scroll=window.scrollY
let scale=1-(scroll/700)
if(scale<0.85) scale=0.85

featured.style.transform="scale("+scale+")"

let opacity=1-(scroll/500)
if(opacity<0.35) opacity=0.35

featured.style.opacity=opacity
})
