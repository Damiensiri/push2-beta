(function initializeProfilePage(){
const form=document.getElementById("profileForm");
const firstName=document.getElementById("profileFirstName");
const email=document.getElementById("profileEmail");
const cardNumber=document.getElementById("profileCardNumber");
const photoInput=document.getElementById("profilePhotoInput");
const photoPreview=document.getElementById("profilePhotoPreview");
const photoFallback=document.getElementById("profilePhotoFallback");
const removePhoto=document.getElementById("removePhoto");
const saveStatus=document.getElementById("profileSaveStatus");
const notificationState=document.getElementById("notificationState");
const resetDialog=document.getElementById("resetDialog");
const openReset=document.getElementById("openReset");
const cancelReset=document.getElementById("cancelReset");
const confirmReset=document.getElementById("confirmReset");

let photoBlob=null;
let photoUrl="";

function setPreview(photo){
if(photoUrl){
URL.revokeObjectURL(photoUrl);
photoUrl="";
}

photoBlob=photo instanceof Blob?photo:null;

if(photoBlob){
photoUrl=URL.createObjectURL(photoBlob);
photoPreview.src=photoUrl;
photoPreview.hidden=false;
photoFallback.hidden=true;
removePhoto.hidden=false;
}else{
photoPreview.removeAttribute("src");
photoPreview.hidden=true;
photoFallback.hidden=false;
removePhoto.hidden=true;
}
}

function notificationLabel(){
if(!("Notification" in window))return["Non disponible","unavailable"];
if(Notification.permission==="granted")return["Autorisées","granted"];
if(Notification.permission==="denied")return["Refusées","denied"];
return["Non activées","default"];
}

function renderNotificationState(){
const [label,state]=notificationLabel();
notificationState.textContent=label;
notificationState.dataset.state=state;
}

function imageFromFile(file){
return new Promise((resolve,reject)=>{
const url=URL.createObjectURL(file);
const image=new Image();
image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Image illisible"));};
image.src=url;
});
}

async function preparePhoto(file){
const image=await imageFromFile(file);
const maxSize=512;
const ratio=Math.min(1,maxSize/Math.max(image.naturalWidth,image.naturalHeight));
const width=Math.max(1,Math.round(image.naturalWidth*ratio));
const height=Math.max(1,Math.round(image.naturalHeight*ratio));
const canvas=document.createElement("canvas");
canvas.width=width;
canvas.height=height;
const context=canvas.getContext("2d",{alpha:false});
context.fillStyle="#ffffff";
context.fillRect(0,0,width,height);
context.drawImage(image,0,0,width,height);

return new Promise((resolve,reject)=>{
canvas.toBlob(blob=>{
if(blob)resolve(blob);
else reject(new Error("Compression impossible"));
},"image/jpeg",.84);
});
}

async function loadProfile(){
const profile=await ProfileStore.get();
firstName.value=profile.firstName;
email.value=profile.email;
cardNumber.value=profile.cardNumber;
setPreview(profile.photo);
renderNotificationState();
}

photoInput.addEventListener("change",async()=>{
const file=photoInput.files?.[0];
if(!file)return;

saveStatus.textContent="Préparation de la photo…";
try{
setPreview(await preparePhoto(file));
saveStatus.textContent="Photo prête à être enregistrée.";
}catch(e){
saveStatus.textContent="Cette photo ne peut pas être utilisée.";
}
photoInput.value="";
});

removePhoto.addEventListener("click",()=>{
setPreview(null);
saveStatus.textContent="La photo sera supprimée à l’enregistrement.";
});

form.addEventListener("submit",async event=>{
event.preventDefault();
if(!form.reportValidity())return;

saveStatus.textContent="Enregistrement…";
try{
await ProfileStore.save({
firstName:firstName.value,
email:email.value,
cardNumber:cardNumber.value,
photo:photoBlob
});
saveStatus.textContent="Profil enregistré sur cet appareil.";
}catch(e){
saveStatus.textContent="Impossible d’enregistrer le profil.";
}
});

openReset.addEventListener("click",()=>{
resetDialog.hidden=false;
});

cancelReset.addEventListener("click",()=>{
resetDialog.hidden=true;
});

confirmReset.addEventListener("click",async()=>{
await ProfileStore.reset();
form.reset();
setPreview(null);
resetDialog.hidden=true;
saveStatus.textContent="Profil réinitialisé sur cet appareil.";
renderNotificationState();
});

resetDialog.addEventListener("click",event=>{
if(event.target===resetDialog)resetDialog.hidden=true;
});

window.addEventListener("beforeunload",()=>{
if(photoUrl)URL.revokeObjectURL(photoUrl);
});

loadProfile();
})();
