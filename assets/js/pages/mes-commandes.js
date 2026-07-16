const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev",TOKEN_KEY="ecurie_beta_session"
const labels={pending:"En attente",validated:"Validée",refused:"Refusée",ready:"Prête",completed:"Terminée",cancelled:"Annulée"}
const colors={pending:"#aaa",validated:"#2ecc71",refused:"#e74c3c",ready:"#f1c40f",completed:"#2ecc71",cancelled:"#e74c3c"}
function esc(value){return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char])}
function money(value){return Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2})}
async function load(){
  try{const response=await fetch(API+"/api/orders",{headers:{authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")}});const data=await response.json();if(!response.ok)throw new Error(data.error||"Service indisponible");const orders=data.orders||[]
    document.getElementById("orders").innerHTML=orders.length?orders.map(order=>`<div class="order"><div class="date">${new Date(order.createdAt).toLocaleString("fr-FR")}</div>${order.items.map(item=>`<div class="item"><div>${esc(item.name)} x${item.quantity}</div><div>${money(item.lineTotal)} €</div></div>`).join("")}<div class="total">Total : ${money(order.total)} €</div><div class="status" style="color:${colors[order.status]||'#aaa'}">Statut : ${labels[order.status]||esc(order.status)}</div>${order.comment?`<div style="margin-top:10px;font-size:14px;opacity:.9"><strong>Info :</strong> ${esc(order.comment)}</div>`:""}</div>`).join(""):'<div class="empty">Aucune commande pour le moment.</div>'
  }catch(error){document.getElementById("orders").innerHTML=`<div class="empty">${esc(error.message)}</div>`}
}
window.addEventListener("pwa-data-changed",event=>{if(["orders","all"].includes(event.detail?.type))load()})
load()
