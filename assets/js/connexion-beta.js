(function(){
const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
const TOKEN_KEY="ecurie_beta_session";
const form=document.getElementById("loginForm");
const status=document.getElementById("loginStatus");
const submit=document.getElementById("loginSubmit");

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

validateExistingSession();
})();
