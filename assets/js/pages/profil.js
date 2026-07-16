(function initializeProfilePage(){
const cardForm=document.getElementById("profileCardForm");
const cardNumber=document.getElementById("profileCardNumber");
const photoInput=document.getElementById("profilePhotoInput");
const photoPreview=document.getElementById("profilePhotoPreview");
const photoFallback=document.getElementById("profilePhotoFallback");
const removePhoto=document.getElementById("removePhoto");
const photoStatus=document.getElementById("profilePhotoStatus");
const cardStatus=document.getElementById("profileCardStatus");
const removeCard=document.getElementById("removeCard");
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
cardNumber.value=profile.cardNumber;
setPreview(profile.photo);
}

async function savePhoto(photo){
const profile=await ProfileStore.get();
await ProfileStore.saveProfile({
firstName:profile.firstName,
lastName:profile.lastName,
email:profile.email,
photo
});
}

photoInput.addEventListener("change",async()=>{
const file=photoInput.files?.[0];
if(!file)return;

photoStatus.textContent="Préparation de la photo…";
try{
await openCropper(file);
photoStatus.textContent="";
}catch(e){
photoStatus.textContent="Cette photo ne peut pas être utilisée.";
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
photoStatus.textContent="";
});

confirmCrop.addEventListener("click",async()=>{
if(!cropImage)return;
confirmCrop.disabled=true;
try{
drawCrop();
const croppedPhoto=await cropToBlob();
setPreview(croppedPhoto);
await savePhoto(croppedPhoto);
closeCropper();
photoStatus.textContent="Photo de profil enregistrée sur cet appareil.";
}catch(e){
photoStatus.textContent="Cette photo ne peut pas être utilisée.";
}finally{
confirmCrop.disabled=false;
}
});

cropDialog.addEventListener("click",event=>{
if(event.target===cropDialog){
closeCropper();
photoStatus.textContent="";
}
});

removePhoto.addEventListener("click",async()=>{
setPreview(null);
try{
await savePhoto(null);
photoStatus.textContent="Photo supprimée de cet appareil.";
}catch(e){
photoStatus.textContent="Impossible de supprimer la photo.";
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

window.addEventListener("beforeunload",()=>{
if(photoUrl)URL.revokeObjectURL(photoUrl);
});

window.addEventListener("profile:account-synced",loadProfile);

loadProfile();
})();
