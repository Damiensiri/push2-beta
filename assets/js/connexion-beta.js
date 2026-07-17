(function(){
const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
const TOKEN_KEY="ecurie_beta_session";
const form=document.getElementById("loginForm");
const status=document.getElementById("loginStatus");
const submit=document.getElementById("loginSubmit");
const registerForm=document.getElementById("registerForm");
const registerStatus=document.getElementById("registerStatus");
const registerSubmit=document.getElementById("registerSubmit");
const showLogin=document.getElementById("showLogin");
const showRegister=document.getElementById("showRegister");
const tabs=document.querySelector(".auth-tabs");
const forgotForm=document.getElementById("forgotForm");
const resetForm=document.getElementById("resetForm");
const resetToken=new URLSearchParams(location.search).get("reset")||"";

function setMode(mode){
const registering=mode==="register";
const forgot=mode==="forgot",reset=mode==="reset";
form.hidden=registering||forgot||reset;registerForm.hidden=!registering;forgotForm.hidden=!forgot;resetForm.hidden=!reset;
tabs.hidden=forgot||reset;
showLogin.classList.toggle("is-active",!registering);showRegister.classList.toggle("is-active",registering);
}
showLogin.addEventListener("click",()=>setMode("login"));
showRegister.addEventListener("click",()=>setMode("register"));
document.getElementById("showForgot").addEventListener("click",()=>setMode("forgot"));
document.querySelectorAll("[data-back-login]").forEach(button=>button.addEventListener("click",()=>setMode("login")));

async function validateExistingSession(){
const token=localStorage.getItem(TOKEN_KEY);
if(!token){document.documentElement.style.visibility="";return;}
document.documentElement.style.visibility="hidden";
try{
const response=await fetch(API+"/api/auth/me",{headers:{authorization:"Bearer "+token},cache:"no-store"});
if(response.ok){location.replace("index.html");return;}
}catch(error){}
localStorage.removeItem(TOKEN_KEY);
document.documentElement.style.visibility="";
}

form.addEventListener("submit",async event=>{
event.preventDefault();submit.disabled=true;status.textContent="Connexion…";
try{
const response=await fetch(API+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:document.getElementById("loginEmail").value,password:document.getElementById("loginPassword").value})});
const data=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(data.error||"Connexion impossible");
localStorage.setItem(TOKEN_KEY,data.token);
location.replace(data.user.mustChangePassword?"profil.html":"index.html");
}catch(error){status.textContent=error.message;submit.disabled=false;}
});

registerForm.addEventListener("submit",async event=>{
event.preventDefault();
const password=document.getElementById("registerPassword").value;
if(password!==document.getElementById("registerPasswordConfirm").value){registerStatus.textContent="Les deux mots de passe ne correspondent pas.";return;}
registerSubmit.disabled=true;registerStatus.textContent="Envoi de la demande…";
try{
const response=await fetch(API+"/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
firstName:document.getElementById("registerFirstName").value,lastName:document.getElementById("registerLastName").value,
email:document.getElementById("registerEmail").value,password})});
const data=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(data.error||"Inscription impossible");
registerForm.reset();registerStatus.textContent="Demande envoyée. Damien doit maintenant valider votre accès.";
}catch(error){registerStatus.textContent=error.message;}finally{registerSubmit.disabled=false;}
});

forgotForm.addEventListener("submit",async event=>{
event.preventDefault();const button=document.getElementById("forgotSubmit"),message=document.getElementById("forgotStatus");button.disabled=true;message.textContent="Envoi…";
try{const response=await fetch(API+"/api/auth/password-reset/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:document.getElementById("forgotEmail").value})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Demande impossible");message.textContent=data.message;}catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});

resetForm.addEventListener("submit",async event=>{
event.preventDefault();const password=document.getElementById("resetPassword").value,message=document.getElementById("resetStatus"),button=document.getElementById("resetSubmit");
if(password!==document.getElementById("resetPasswordConfirm").value){message.textContent="Les deux mots de passe ne correspondent pas.";return;}
button.disabled=true;message.textContent="Enregistrement…";
try{const response=await fetch(API+"/api/auth/password-reset/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:resetToken,newPassword:password})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Réinitialisation impossible");resetForm.reset();message.textContent="Mot de passe modifié. Retour à la connexion…";history.replaceState(null,"","connexion.html");setTimeout(()=>setMode("login"),1000);}catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});

if(resetToken)setMode("reset");
validateExistingSession();
window.addEventListener("pageshow",event=>{
if(event.persisted||localStorage.getItem(TOKEN_KEY))validateExistingSession();
});
})();
