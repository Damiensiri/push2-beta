/* ===== CONTENU ORIGINAL ===== */

let order = JSON.parse(localStorage.getItem("lastOrder") || "{}")

let html=""

if(order.items){

order.items.forEach(item=>{

html+=`
<div class="item">
<div>${item.name} x${item.qty}</div>
<div>${item.price*item.qty} €</div>
</div>
`

})

document.getElementById("order").innerHTML=html
document.getElementById("total").innerText=order.total

}else{

document.getElementById("order").innerHTML="Aucune commande trouvée."

}

/* BOUTON FERMER */

function closeOrder(){

const p=document.getElementById("page")

p.classList.remove("active")
p.classList.add("exit")

setTimeout(()=>{
window.location.href="mes-commandes.html"
},300)

}
