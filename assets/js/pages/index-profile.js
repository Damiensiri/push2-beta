(function initializeIndexProfile(){
let photoUrl="";

function setPhoto(photo){
const image=document.getElementById("userShortcutPhoto");
const fallback=document.getElementById("userShortcutFallback");
if(!image||!fallback)return;

if(photoUrl){
URL.revokeObjectURL(photoUrl);
photoUrl="";
}

if(photo instanceof Blob){
photoUrl=URL.createObjectURL(photo);
image.src=photoUrl;
image.hidden=false;
fallback.hidden=true;
}else{
image.removeAttribute("src");
image.hidden=true;
fallback.hidden=false;
}
}

async function renderProfile(){
if(!window.ProfileStore)return;
const profile=await ProfileStore.get();
const label=document.getElementById("userShortcutName");
if(label)label.textContent=profile.firstName||"Profil";
setPhoto(profile.photo);
}

window.addEventListener("DOMContentLoaded",renderProfile);
window.addEventListener("pageshow",renderProfile);
window.addEventListener("beforeunload",()=>{
if(photoUrl)URL.revokeObjectURL(photoUrl);
});
})();
