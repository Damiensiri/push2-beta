(function(){
"use strict"

const ENDPOINT="https://script.google.com/macros/s/AKfycbx278-X4lrLlua_Jns-UfO04PDWDhk7qOTnsF2BW_VuMjgNnlHIxvsW9fk35HI6nJl-eQ/exec"
const ORDER_SOURCES=["soins","services","laverie","panier"]

function sendPayload(payload){
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

return sendPayload(payload)
}

function sendPaddockRequestConfirmation(data){
const email=String(data?.customer?.email || "").trim()
const date=String(data?.date || "").trim()
const requestId=String(data?.requestId || Date.now()).trim()
const payload={
type:"paddock_request_confirmation",
idempotencyKey:`paddock-request:${date}:${email.toLowerCase()}:${requestId}`,
customer:{
email,
firstName:String(data?.customer?.firstName || "").trim(),
lastName:String(data?.customer?.lastName || "").trim()
},
request:{date}
}

return sendPayload(payload)
}

function sendPaddockReservationConfirmation(data){
const reservationId=String(data?.reservationId || "").trim()
const payload={
type:"paddock_reservation_confirmation",
idempotencyKey:`paddock-reservation:${reservationId}`,
customer:{
email:String(data?.customer?.email || "").trim(),
firstName:String(data?.customer?.firstName || "").trim(),
lastName:String(data?.customer?.lastName || "").trim()
},
reservation:{
id:reservationId,
paddock:String(data?.paddock || "").trim(),
date:String(data?.date || "").trim(),
time:String(data?.time || "").trim(),
duration:Number(data?.duration)
}
}

return sendPayload(payload)
}

window.AppMailer=Object.freeze({
sendOrderConfirmation,
sendPaddockRequestConfirmation,
sendPaddockReservationConfirmation
})
})()
