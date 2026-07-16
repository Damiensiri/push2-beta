(function(){
const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
const TOKEN_KEY="ecurie_beta_session";
const loggedOut=document.getElementById("accountLoggedOut");
const loggedIn=document.getElementById("accountLoggedIn");
const loginForm=document.getElementById("accountLoginForm");
const passwordForm=document.getElementById("accountPasswordForm");
const identity=document.getElementById("accountIdentity");
const status=document.getElementById("accountStatus");
let currentUser=null;

async function request(path,options={}){
const token=localStorage.getItem(TOKEN_KEY)||"";
const response=await fetch(API+path,{...options,headers:{...(token?{authorization:"Bearer "+token}:{}),...(options.body?{"content-type":"application/json"}:{})}});
const data=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(data.error||`Erreur ${response.status}`);
return data;
}

async function copyToLocalProfile(user){
const existing=await ProfileStore.get();
await ProfileStore.saveProfile({firstName:user.firstName,lastName:user.lastName,email:user.email,photo:existing.photo});
if(user.cardNumber)ProfileStore.saveCardNumber(user.cardNumber);
window.dispatchEvent(new CustomEvent("profile:account-synced",{detail:user}));
}

async function showUser(user){
currentUser=user;loggedOut.hidden=true;loggedIn.hidden=false;
identity.textContent=`${user.firstName} ${user.lastName} · ${user.email}`;
passwordForm.hidden=!user.mustChangePassword;
await copyToLocalProfile(user);
}

function showLoggedOut(){currentUser=null;loggedOut.hidden=false;loggedIn.hidden=true;passwordForm.hidden=true;}

loginForm.addEventListener("submit",async event=>{
event.preventDefault();status.textContent="Connexion…";
try{const data=await request("/api/auth/login",{method:"POST",body:JSON.stringify({email:document.getElementById("accountEmail").value,password:document.getElementById("accountPassword").value})});localStorage.setItem(TOKEN_KEY,data.token);loginForm.reset();await showUser(data.user);status.textContent=data.user.mustChangePassword?"Compte connecté. Choisissez maintenant un nouveau mot de passe.":"Compte bêta connecté.";}catch(error){status.textContent=error.message;}
});

passwordForm.addEventListener("submit",async event=>{
event.preventDefault();status.textContent="Enregistrement…";
try{const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({currentPassword:document.getElementById("currentPassword").value,newPassword:document.getElementById("newPassword").value})});passwordForm.reset();await showUser(data.user);status.textContent="Nouveau mot de passe enregistré.";}catch(error){status.textContent=error.message;}
});

document.getElementById("accountLogout").addEventListener("click",async()=>{
try{await request("/api/auth/logout",{method:"POST"});}catch(error){}localStorage.removeItem(TOKEN_KEY);showLoggedOut();status.textContent="Compte déconnecté de cet appareil.";
});

(async()=>{if(!localStorage.getItem(TOKEN_KEY)){showLoggedOut();return;}try{const data=await request("/api/auth/me");await showUser(data.user);status.textContent="Compte bêta connecté.";}catch(error){localStorage.removeItem(TOKEN_KEY);showLoggedOut();status.textContent="La session bêta a expiré.";}})();
})();
