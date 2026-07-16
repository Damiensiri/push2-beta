const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev",TOKEN_KEY="ecurie_beta_session"
let cart=JSON.parse(localStorage.getItem("cart")||"[]")
const commanderBtn=document.getElementById("commanderBtn")
function esc(value){return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char])}
function money(value){return Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2})}
async function api(path,options={}){const response=await fetch(API+path,{...options,headers:{authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||""),...(options.body?{"content-type":"application/json"}:{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Service indisponible");return data}
function render(){let total=0;document.getElementById("cartList").innerHTML=cart.map(item=>{total+=item.price*item.qty;return `<div class="item"><div>${esc(item.name)} x${item.qty}</div><div>${money(item.price*item.qty)} €</div></div>`}).join("");document.getElementById("total").innerText=money(total);commanderBtn.disabled=!cart.length}
function vider(){localStorage.removeItem("cart");cart=[];render()}
document.getElementById("checkoutForm").addEventListener("submit",event=>{event.preventDefault();commander()})
async function commander(){if(!cart.length)return;commanderBtn.disabled=true;try{const data=await api("/api/orders",{method:"POST",body:JSON.stringify({source:"panier",items:cart.map(item=>({productId:item.productId,quantity:item.qty}))})});localStorage.setItem("lastOrder",JSON.stringify(data.order));localStorage.removeItem("cart");location.href="confirmation.html"}catch(error){alert(error.message);commanderBtn.disabled=false}}
render()
