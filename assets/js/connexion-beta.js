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

function setMode(mode){
const registering=mode==="register";
form.hidden=registering;registerForm.hidden=!registering;
showLogin.classList.toggle("is-active",!registering);showRegister.classList.toggle("is-active",registering);
}
showLogin.addEventListener("click",()=>setMode("login"));
showRegister.addEventListener("click",()=>setMode("register"));

async function validateExistingSession(){
const token=localStorage.getItem(TOKEN_KEY);
if(!token)return;
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

validateExistingSession();
})();
