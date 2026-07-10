(function initializePlanningPaddockProfile(){
let profile={
firstName:"",
email:""
};

function isAdminMode(){
try{
return typeof adminMode!=="undefined" && adminMode;
}catch(e){
return false;
}
}

function getElements(){
return {
type:document.getElementById("type"),
firstName:document.getElementById("name"),
email:document.getElementById("email"),
emailLabel:document.getElementById("emailLabel"),
emailChoice:document.getElementById("emailConfirmationChoice"),
emailCheckbox:document.getElementById("emailConfirmation"),
emailNotice:document.getElementById("emailProfileNotice"),
profileNotice:document.getElementById("profileRequiredNotice")
};
}

function syncProfileFields(){
const {
type,
firstName,
email,
emailLabel,
emailChoice,
emailCheckbox,
emailNotice,
profileNotice
}=getElements();

if(!type || !firstName || !email || !emailLabel || !emailChoice || !emailCheckbox || !emailNotice || !profileNotice)return;

const admin=isAdminMode();
const mise=type.value==="mise";
const hasFirstName=Boolean(profile.firstName);
const hasEmail=Boolean(profile.email && profile.email.includes("@"));

if(admin){
firstName.readOnly=false;
firstName.classList.remove("profileLockedField");
email.readOnly=false;
email.classList.remove("profileLockedField");
email.hidden=false;
emailLabel.hidden=false;
emailChoice.hidden=true;
emailNotice.hidden=true;
profileNotice.hidden=true;
email.required=mise;
emailLabel.innerText=mise?"Email (obligatoire)":"Email (optionnel)";
return;
}

firstName.value=profile.firstName || "";
firstName.readOnly=true;
firstName.classList.add("profileLockedField");
profileNotice.hidden=hasFirstName;

if(mise){
email.value=profile.email || "";
email.readOnly=true;
email.hidden=false;
email.required=true;
email.classList.add("profileLockedField");
emailLabel.hidden=false;
emailLabel.innerText="Email (obligatoire)";
emailChoice.hidden=true;
emailNotice.hidden=hasEmail;
return;
}

email.required=false;
email.readOnly=true;
email.classList.add("profileLockedField");
emailLabel.hidden=true;
email.hidden=true;
emailChoice.hidden=false;
emailCheckbox.disabled=!hasEmail;
emailNotice.hidden=hasEmail;

if(hasEmail && emailCheckbox.checked){
email.value=profile.email;
}else{
email.value="";
}
}

async function loadProfile(){
if(!window.ProfileStore){
syncProfileFields();
return;
}

try{
const storedProfile=await ProfileStore.get();
profile={
firstName:String(storedProfile.firstName||"").trim(),
email:String(storedProfile.email||"").trim()
};
}catch(e){
profile={firstName:"",email:""};
}

syncProfileFields();
}

function bindEvents(){
const {type,emailCheckbox}=getElements();

if(type){
type.addEventListener("change",()=>{
queueMicrotask(syncProfileFields);
});
}

if(emailCheckbox){
emailCheckbox.addEventListener("change",syncProfileFields);
}
}

window.PlanningPaddockProfile={
sync:syncProfileFields,
reload:loadProfile
};

function start(){
bindEvents();
loadProfile();
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",start);
}else{
start();
}

window.addEventListener("pageshow",loadProfile);
})();
