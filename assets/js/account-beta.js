(function(){
const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
const TOKEN_KEY="ecurie_beta_session";
const identity=document.getElementById("accountIdentity");
const passwordForm=document.getElementById("accountPasswordForm");
const status=document.getElementById("accountStatus");

async function request(path,options={}){
const token=localStorage.getItem(TOKEN_KEY)||"";
const response=await fetch(API+path,{...options,headers:{authorization:"Bearer "+token,...(options.body?{"content-type":"application/json"}:{})}});
const data=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(data.error||`Erreur ${response.status}`);
return data;
}

async function copyToLocalProfile(user){
const existing=await ProfileStore.get();
await ProfileStore.saveProfile({firstName:user.firstName,lastName:user.lastName,email:user.email,photo:existing.photo});
if(user.cardNumber)ProfileStore.saveCardNumber(user.cardNumber);else ProfileStore.removeCardNumber();
window.dispatchEvent(new CustomEvent("profile:account-synced",{detail:user}));
}

async function showUser(user){
identity.textContent=`${user.firstName} ${user.lastName}`;
document.getElementById("accountEmailDisplay").textContent=user.email;
document.getElementById("accountRoleDisplay").textContent=user.role==="client"?"Client":user.role;
passwordForm.hidden=!user.mustChangePassword;
await copyToLocalProfile(user);
}

passwordForm.addEventListener("submit",async event=>{
event.preventDefault();status.textContent="Enregistrement…";
try{const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({currentPassword:document.getElementById("currentPassword").value,newPassword:document.getElementById("newPassword").value})});passwordForm.reset();await showUser(data.user);status.textContent="Nouveau mot de passe enregistré.";}catch(error){status.textContent=error.message;}
});

document.getElementById("accountLogout").addEventListener("click",async()=>{
try{await request("/api/auth/logout",{method:"POST"});}catch(error){}
localStorage.removeItem(TOKEN_KEY);location.replace("connexion.html");
});

document.getElementById("profileCardForm").addEventListener("submit",async()=>{
try{
const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({cardNumber:document.getElementById("profileCardNumber").value})});
await showUser(data.user);document.getElementById("profileCardStatus").textContent="Carte paddock enregistrée dans votre compte.";
}catch(error){document.getElementById("profileCardStatus").textContent="Enregistrement local effectué, synchronisation impossible.";}
});

document.getElementById("removeCard").addEventListener("click",async()=>{
try{const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({cardNumber:""})});await showUser(data.user);}catch(error){}
});

(async()=>{try{const data=await request("/api/auth/me");await showUser(data.user);}catch(error){localStorage.removeItem(TOKEN_KEY);location.replace("connexion.html");}})();
})();
