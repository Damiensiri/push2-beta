(function initializeServiceProfile(){
async function applyLocalProfile(){
if(!window.ProfileStore)return;

let profile;
try{
profile=await ProfileStore.get();
}catch(e){
return;
}

const firstName=document.getElementById("clientPrenom");
const lastName=document.getElementById("clientNom");
const email=document.getElementById("clientEmail");

if(firstName && !firstName.value.trim() && profile.firstName){
firstName.value=profile.firstName;
}

if(lastName && !lastName.value.trim() && profile.lastName){
lastName.value=profile.lastName;
}

if(email && !email.value.trim() && profile.email){
email.value=profile.email;
}
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",applyLocalProfile);
}else{
applyLocalProfile();
}
})();
