(function initializeProfilePage(){
const form=document.getElementById("profileForm");
const cardForm=document.getElementById("profileCardForm");
const firstName=document.getElementById("profileFirstName");
const lastName=document.getElementById("profileLastName");
const email=document.getElementById("profileEmail");
const cardNumber=document.getElementById("profileCardNumber");
const photoInput=document.getElementById("profilePhotoInput");
const photoPreview=document.getElementById("profilePhotoPreview");
const photoFallback=document.getElementById("profilePhotoFallback");
const removePhoto=document.getElementById("removePhoto");
const saveStatus=document.getElementById("profileSaveStatus");
const cardStatus=document.getElementById("profileCardStatus");
const removeCard=document.getElementById("removeCard");
const resetDialog=document.getElementById("resetDialog");
const openReset=document.getElementById("openReset");
const cancelReset=document.getElementById("cancelReset");
const confirmReset=document.getElementById("confirmReset");
const cropDialog=document.getElementById("cropDialog");
const cropCanvas=document.getElementById("cropCanvas");
const cropZoom=document.getElementById("cropZoom");
const cancelCrop=document.getElementById("cancelCrop");
const confirmCrop=document.getElementById("confirmCrop");
const cropContext=cropCanvas.getContext("2d",{alpha:false});

let photoBlob=null;
let photoUrl="";
let cropImage=null;
let cropBaseScale=1;
let cropScale=1;
let cropOffsetX=0;
let cropOffsetY=0;
let cropPointerId=null;
let cropPointerX=0;
let cropPointerY=0;

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

function imageFromFile(file){
return new Promise((resolve,reject)=>{
const url=URL.createObjectURL(file);
const image=new Image();
image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Image illisible"));};
image.src=url;
});
}

function clampCropOffsets(){
if(!cropImage)return;
const width=cropImage.naturalWidth*cropBaseScale*cropScale;
const height=cropImage.naturalHeight*cropBaseScale*cropScale;
const maxX=Math.max(0,(width-cropCanvas.width)/2);
const maxY=Math.max(0,(height-cropCanvas.height)/2);
cropOffsetX=Math.max(-maxX,Math.min(maxX,cropOffsetX));
cropOffsetY=Math.max(-maxY,Math.min(maxY,cropOffsetY));
}

function drawCrop(){
if(!cropImage)return;
clampCropOffsets();
const width=cropImage.naturalWidth*cropBaseScale*cropScale;
const height=cropImage.naturalHeight*cropBaseScale*cropScale;
const x=(cropCanvas.width-width)/2+cropOffsetX;
const y=(cropCanvas.height-height)/2+cropOffsetY;
cropContext.fillStyle="#ffffff";
cropContext.fillRect(0,0,cropCanvas.width,cropCanvas.height);
cropContext.drawImage(cropImage,x,y,width,height);
}

async function openCropper(file){
cropImage=await imageFromFile(file);
cropBaseScale=Math.max(
cropCanvas.width/cropImage.naturalWidth,
cropCanvas.height/cropImage.naturalHeight
);
cropScale=1;
cropOffsetX=0;
cropOffsetY=0;
cropZoom.value="1";
cropDialog.hidden=false;
drawCrop();
}

function closeCropper(){
cropDialog.hidden=true;
cropImage=null;
cropPointerId=null;
}

function cropToBlob(){
return new Promise((resolve,reject)=>{
cropCanvas.toBlob(blob=>{
if(blob)resolve(blob);
else reject(new Error("Compression impossible"));
},"image/jpeg",.84);
});
}

async function loadProfile(){
const profile=await ProfileStore.get();
firstName.value=profile.firstName;
lastName.value=profile.lastName;
email.value=profile.email;
cardNumber.value=profile.cardNumber;
setPreview(profile.photo);
}

photoInput.addEventListener("change",async()=>{
const file=photoInput.files?.[0];
if(!file)return;

saveStatus.textContent="Préparation de la photo…";
try{
await openCropper(file);
saveStatus.textContent="";
}catch(e){
saveStatus.textContent="Cette photo ne peut pas être utilisée.";
}
photoInput.value="";
});

cropCanvas.addEventListener("pointerdown",event=>{
if(!cropImage)return;
cropPointerId=event.pointerId;
cropPointerX=event.clientX;
cropPointerY=event.clientY;
cropCanvas.setPointerCapture(event.pointerId);
});

cropCanvas.addEventListener("pointermove",event=>{
if(event.pointerId!==cropPointerId||!cropImage)return;
const rect=cropCanvas.getBoundingClientRect();
const ratio=cropCanvas.width/rect.width;
cropOffsetX+=(event.clientX-cropPointerX)*ratio;
cropOffsetY+=(event.clientY-cropPointerY)*ratio;
cropPointerX=event.clientX;
cropPointerY=event.clientY;
drawCrop();
});

function stopCropDrag(event){
if(event.pointerId!==cropPointerId)return;
cropPointerId=null;
}

cropCanvas.addEventListener("pointerup",stopCropDrag);
cropCanvas.addEventListener("pointercancel",stopCropDrag);

cropZoom.addEventListener("input",()=>{
if(!cropImage)return;
const nextScale=Number(cropZoom.value)||1;
const ratio=nextScale/cropScale;
cropOffsetX*=ratio;
cropOffsetY*=ratio;
cropScale=nextScale;
drawCrop();
});

cancelCrop.addEventListener("click",()=>{
closeCropper();
saveStatus.textContent="";
});

confirmCrop.addEventListener("click",async()=>{
if(!cropImage)return;
confirmCrop.disabled=true;
try{
drawCrop();
setPreview(await cropToBlob());
closeCropper();
saveStatus.textContent="Photo prête à être enregistrée.";
}catch(e){
saveStatus.textContent="Cette photo ne peut pas être utilisée.";
}finally{
confirmCrop.disabled=false;
}
});

cropDialog.addEventListener("click",event=>{
if(event.target===cropDialog){
closeCropper();
saveStatus.textContent="";
}
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
await ProfileStore.saveProfile({
firstName:firstName.value,
lastName:lastName.value,
email:email.value,
photo:photoBlob
});
saveStatus.textContent="Profil enregistré sur cet appareil.";
}catch(e){
saveStatus.textContent="Impossible d’enregistrer le profil.";
}
});

cardForm.addEventListener("submit",event=>{
event.preventDefault();
if(!cardForm.reportValidity())return;

cardStatus.textContent="Enregistrement…";
try{
const savedNumber=ProfileStore.saveCardNumber(cardNumber.value);
cardNumber.value=savedNumber;
cardStatus.textContent="Carte paddock enregistrée sur cet appareil.";
}catch(e){
cardStatus.textContent="Impossible d’enregistrer la carte.";
}
});

removeCard.addEventListener("click",()=>{
ProfileStore.removeCardNumber();
cardForm.reset();
cardStatus.textContent="Carte paddock supprimée de cet appareil.";
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
cardForm.reset();
setPreview(null);
resetDialog.hidden=true;
saveStatus.textContent="Profil réinitialisé sur cet appareil.";
cardStatus.textContent="";
});

resetDialog.addEventListener("click",event=>{
if(event.target===resetDialog)resetDialog.hidden=true;
});

window.addEventListener("beforeunload",()=>{
if(photoUrl)URL.revokeObjectURL(photoUrl);
});

window.addEventListener("profile:account-synced",loadProfile);

loadProfile();
})();
