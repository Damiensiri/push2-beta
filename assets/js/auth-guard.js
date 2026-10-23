(function(){
const token=localStorage.getItem("ecurie_beta_session")||"";
document.documentElement.style.visibility="hidden";
if(!token){location.replace("connexion.html");return;}
fetch("https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/auth/me",{
headers:{authorization:"Bearer "+token},cache:"no-store"
}).then(response=>{
if(!response.ok)throw new Error("Session invalide");
document.documentElement.style.visibility="";
}).catch(()=>{
localStorage.removeItem("ecurie_beta_session");location.replace("connexion.html");
});
})();
