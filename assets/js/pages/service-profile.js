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

function fillEmptyField(field,value){
if(!field || field.value.trim() || !value)return;
field.value=value;
field.dispatchEvent(new Event("input",{bubbles:true}));
}

fillEmptyField(firstName,profile.firstName);
fillEmptyField(lastName,profile.lastName);
fillEmptyField(email,profile.email);
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",applyLocalProfile);
}else{
applyLocalProfile();
}
})();
