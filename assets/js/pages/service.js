const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev"
const TOKEN_KEY="ecurie_beta_session"
const category=document.body.dataset.catalogCategory||document.body.dataset.mailSource||"services"
let cart=JSON.parse(localStorage.getItem("cart")||"[]")
let products=[]

async function api(path,options={}){
  const response=await fetch(API+path,{...options,headers:{authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||""),
    ...(options.body?{"content-type":"application/json"}:{})}})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||"Service indisponible")
  return data
}
function esc(value){return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char])}
function money(value){return Number(value).toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:2})}

async function loadCatalog(){
  try{
    products=(await api("/api/catalog?category="+encodeURIComponent(category))).products||[]
    cart=cart.map(item=>{const product=products.find(p=>p.id===item.productId||p.name===item.name);return product?{productId:product.id,name:product.name,price:product.price,qty:item.qty}:item})
    render();updateCart()
  }catch(error){document.getElementById("products").innerHTML=`<div class="card"><div class="content">${esc(error.message)}</div></div>`}
}
function productMarkup(p,featured=false){return `${featured?`<img src="${esc(p.image)}" alt="">`:``}<div class="${featured?"":"imgBox"}">${featured?"":`<img src="${esc(p.image)}" alt="">${p.badge?`<div class="badge">${esc(p.badge)}</div>`:""}`}</div><div class="${featured?"":"content"}"${featured?' id="featuredContent"':""}><${featured?"h2":"div"}${featured?"":' class="title"'}>${esc(p.name)}</${featured?"h2":"div"}><div class="${featured?"desc":"desc"}">${esc(p.description)}</div><div class="bottom"><div class="price">${money(p.price)} €</div><button class="addBtn" data-id="${esc(p.id)}">Ajouter</button></div></div>`}
function render(){
  const featured=document.getElementById("featured"),list=document.getElementById("products");featured.innerHTML="";list.innerHTML=""
  products.forEach(p=>{if(p.featured){featured.innerHTML=productMarkup(p,true)}else{const card=document.createElement("div");card.className="card";card.innerHTML=productMarkup(p);list.appendChild(card)}})
}
document.addEventListener("click",event=>{const button=event.target.closest(".addBtn");if(!button)return;const product=products.find(p=>p.id===button.dataset.id);if(product)addCart(product,button)})
function addCart(product,button){
  const original=button.innerText;button.innerText="✓ Ajouté";setTimeout(()=>button.innerText=original,1000)
  const item=cart.find(value=>value.productId===product.id);if(item)item.qty++;else cart.push({productId:product.id,name:product.name,price:product.price,qty:1})
  updateCart();document.getElementById("cartBtn").classList.add("pulse");setTimeout(()=>document.getElementById("cartBtn").classList.remove("pulse"),400)
}
function updateCart(){
  localStorage.setItem("cart",JSON.stringify(cart));document.getElementById("count").innerText=cart.reduce((sum,item)=>sum+item.qty,0)
  let total=0;document.getElementById("cartItems").innerHTML=cart.map((item,index)=>{total+=item.price*item.qty;return `<div class="cartItem"><div>${esc(item.name)}<br>${money(item.price)}€</div><div class="qty"><button onclick="changeQty(${index},-1)">-</button>${item.qty}<button onclick="changeQty(${index},1)">+</button></div></div>`}).join("")
  document.getElementById("total").innerText=money(total)
}
function changeQty(index,value){cart[index].qty+=value;if(cart[index].qty<=0)cart.splice(index,1);updateCart()}
function toggleCart(){document.getElementById("cartPanel").classList.toggle("open")}
async function checkout(){
  if(!cart.length)return alert("Panier vide")
  const button=document.querySelector(".checkoutBtn");button.disabled=true
  try{
    const data=await api("/api/orders",{method:"POST",body:JSON.stringify({source:category,items:cart.map(item=>({productId:item.productId,quantity:item.qty}))})})
    localStorage.setItem("lastOrder",JSON.stringify(data.order));localStorage.removeItem("cart");cart=[];updateCart();location.href="confirmation.html"
  }catch(error){alert(error.message);button.disabled=false}
}
const featured=document.getElementById("featured")
window.addEventListener("scroll",()=>{if(!featured)return;featured.style.transform=`scale(${Math.max(.85,1-window.scrollY/700)})`;featured.style.opacity=Math.max(.35,1-window.scrollY/500)})
loadCatalog()
