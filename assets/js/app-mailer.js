(function(){
"use strict"

const ENDPOINT="https://script.google.com/macros/s/AKfycbyiBfLdYOpHZOS95pUHiRS-HXDdgub3fPtLXlmMU9Gvjq4U182NkW3F0mcC93kD8-pL/exec"
const ORDER_SOURCES=["soins","services","laverie","panier"]

function sendOrderConfirmation(data){
if(!data || !ORDER_SOURCES.includes(data.source)){
return Promise.reject(new Error("Origine de commande invalide"))
}

const payload={
type:"order_confirmation",
idempotencyKey:`order:${data.source}:${data.orderId}`,
customer:{
email:String(data.customer?.email || "").trim(),
firstName:String(data.customer?.firstName || "").trim(),
lastName:String(data.customer?.lastName || "").trim()
},
order:{
id:String(data.orderId),
source:data.source,
total:Number(data.total),
items:(data.items || []).map(item=>({
name:String(item.name || "").trim(),
quantity:Number(item.quantity),
lineTotal:Number(item.lineTotal)
}))
}
}

return fetch(ENDPOINT,{
method:"POST",
mode:"no-cors",
cache:"no-store",
credentials:"omit",
referrerPolicy:"no-referrer",
keepalive:true,
headers:{"Content-Type":"text/plain;charset=UTF-8"},
body:JSON.stringify(payload)
})
}

window.AppMailer=Object.freeze({sendOrderConfirmation})
})()
