(function initializePlanningPaddockProfile(){
async function applyLocalProfile(){
if(!window.ProfileStore)return;

let profile;
try{
profile=await ProfileStore.get();
}catch(e){
return;
}

const type=document.getElementById("type");
const firstName=document.getElementById("name");
const email=document.getElementById("email");

if(!type || !firstName || !email)return;

if(!firstName.value.trim() && profile.firstName){
firstName.value=profile.firstName;
}

let automaticEmail="";

function syncRequiredEmail(){
if(email.required){
if(!email.value.trim() && profile.email){
email.value=profile.email;
automaticEmail=profile.email;
}
return;
}

if(automaticEmail && email.value===automaticEmail){
email.value="";
automaticEmail="";
}
}

email.addEventListener("input",()=>{
if(automaticEmail && email.value!==automaticEmail){
automaticEmail="";
}
});

type.addEventListener("change",()=>{
queueMicrotask(syncRequiredEmail);
});

syncRequiredEmail();
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",applyLocalProfile);
}else{
applyLocalProfile();
}
})();
