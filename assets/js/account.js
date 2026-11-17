(function(){
const API="https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
const TOKEN_KEY="ecurie_beta_session";
const identity=document.getElementById("accountIdentity");
const passwordForm=document.getElementById("accountPasswordForm");
const status=document.getElementById("accountStatus");
const openPasswordChange=document.getElementById("openPasswordChange");
const passwordHelp=document.getElementById("accountPasswordHelp");
const cardContent=document.getElementById("profileCardContent");
const lessonCardsContent=document.getElementById("lessonCardsContent");
const emailForm=document.getElementById("accountEmailForm");
const openEmailChange=document.getElementById("openEmailChange");

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
}

async function photoRequest(method="GET",body=null){
const token=localStorage.getItem(TOKEN_KEY)||"";
return fetch(API+"/api/auth/profile-photo",{method,body,headers:{authorization:"Bearer "+token,...(body?{"content-type":body.type||"image/jpeg"}:{})}});
}

async function saveLocalPhoto(photo){
const profile=await ProfileStore.get();
await ProfileStore.saveProfile({firstName:profile.firstName,lastName:profile.lastName,email:profile.email,photo});
window.dispatchEvent(new CustomEvent("profile:account-synced"));
}

async function syncRemotePhoto(){
const response=await photoRequest();
if(response.ok){
await saveLocalPhoto(await response.blob());
return;
}
if(response.status!==404)throw new Error("Photo indisponible");
const profile=await ProfileStore.get();
if(profile.photo){
const upload=await photoRequest("PUT",profile.photo);
if(!upload.ok)throw new Error("Migration de la photo impossible");
}
window.dispatchEvent(new CustomEvent("profile:account-synced"));
}

window.BetaAccountPhoto={
async save(photo){
const response=await photoRequest("PUT",photo);
if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||"Enregistrement impossible");}
},
async remove(){
const response=await photoRequest("DELETE");
if(!response.ok)throw new Error("Suppression impossible");
}
};

async function showPaddockCard(){
try{
const account=await request("/api/paddocks/card");
const card=account.card;
const offer=account.offer;
const canRequest=offer?.active&&(!card||Number(card.remaining)===0)&&!account.cardRequestPending;
const requestButton=canRequest?`<button type="button" class="profile-primary profile-card-request">Demander ${offer.name} · ${offer.units} mises · ${Number(offer.price).toLocaleString("fr-FR",{minimumFractionDigits:2})} €</button>`:"";
if(!card){
cardContent.innerHTML=`<p class="profile-card-message">${account.cardRequestPending?"Votre demande de carte est en attente de facturation.":"Aucune carte active."}</p>${requestButton}`;
bindCardRequest(account);
return;
}

const remaining=Math.max(0,Number(card.remaining)||0);
const total=Math.max(0,Number(card.total)||0);
const progress=total>0?Math.min(100,Math.max(0,(remaining/total)*100)):0;
const progressColor=remaining>=5?"profile-progress-green":remaining>=2?"profile-progress-orange":"profile-progress-red";
const balance=remaining===0?'<span class="profile-card-complete">Carte épuisée</span>':`${remaining} / ${total}`;
cardContent.innerHTML=`
<p class="profile-card-balance"><strong>Mises restantes :</strong> ${balance}</p>
<div class="profile-card-progress" role="progressbar" aria-label="Mises restantes" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${remaining}">
<div class="${progressColor}" style="width:${progress}%"></div>
</div>${account.cardRequestPending?'<p class="profile-card-message">Votre nouvelle carte est en attente de facturation.</p>':requestButton}`;
bindCardRequest(account);
}catch(error){
cardContent.innerHTML='<p class="profile-card-message">Impossible d’actualiser la carte pour le moment.</p>';
}
}

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function lessonDate(value){if(!value)return "À préciser";return new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(`${value}T12:00:00`));}
async function showLessonCards(){
if(!lessonCardsContent)return;
try{
const account=await request("/api/courses");
const cards=(account.cards||[]).filter(card=>card.credit_type==="card");
if(!cards.length){lessonCardsContent.innerHTML='<p class="profile-card-message">Aucune carte de reprises.</p>';return;}
const riderColor=window.RiderColors.create([...(account.planning?.riders||[]).map(rider=>rider.id),...cards.map(card=>card.participant_profile_id)]);
lessonCardsContent.innerHTML=cards.map(card=>{
const remaining=Math.max(0,Number(card.balance_sessions)||0),total=Math.max(0,Number(card.original_sessions)||0),progress=total?Math.min(100,(remaining/total)*100):0,finished=remaining===0||card.status!=="active",rider=`${card.first_name||""} ${card.last_name||""}`.trim();
return `<article class="profile-lesson-card${finished?' is-finished':''}" style="--rider-color:${riderColor(card.participant_profile_id)}"><i class="profile-rider-stripe" aria-hidden="true"></i><header><span><small>CARTE DE REPRISES</small><strong>${escapeHtml(card.label||"Carte")}</strong></span><b>${remaining}/${total}</b></header><p class="profile-lesson-rider">${escapeHtml(rider||"Cavalier")}</p><div class="profile-card-progress" role="progressbar" aria-label="Séances restantes pour ${escapeHtml(rider)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${remaining}"><div class="${remaining===0?'profile-progress-red':remaining/Math.max(1,total)<=.25?'profile-progress-orange':'profile-progress-green'}" style="width:${progress}%"></div></div><footer><span>Valable du ${lessonDate(card.starts_on)} au ${lessonDate(card.ends_on)}</span>${finished?'<b>Carte terminée</b>':`<b>${remaining} séance${remaining>1?'s':''} restante${remaining>1?'s':''}</b>`}</footer></article>`;
}).join("");
}catch(error){lessonCardsContent.innerHTML=`<p class="profile-card-message">${escapeHtml(error.message||"Impossible d’actualiser les cartes pour le moment.")}</p>`;}
}

function bindCardRequest(account){
const button=cardContent.querySelector(".profile-card-request");if(!button)return;
button.addEventListener("click",async()=>{const offer=account.offer,invoiceCount=(account.usages||[]).filter(item=>item.mode==="invoice").length;
if(!confirm(`Demander ${offer.name} de ${offer.units} mises pour ${Number(offer.price).toLocaleString("fr-FR",{minimumFractionDigits:2})} € ?${invoiceCount?`\n\n${Math.min(invoiceCount,offer.units)} mise(s) à l’unité seront déduites de la nouvelle carte.`:""}`))return;
button.disabled=true;status.textContent="Activation de la carte…";
try{const result=await request("/api/paddocks/card/request",{method:"POST"});status.textContent=`Carte activée : ${result.card.remaining} mise(s) restante(s). Un e-mail de confirmation a été envoyé.`;await showPaddockCard()}catch(error){status.textContent=error.message;button.disabled=false}
});
}

async function showUser(user){
identity.textContent=`${user.firstName} ${user.lastName}`;
document.getElementById("accountEmailDisplay").textContent=user.email;
passwordForm.hidden=!user.mustChangePassword;
openPasswordChange.hidden=user.mustChangePassword;
openPasswordChange.textContent="Changer mon mot de passe";
passwordHelp.textContent=user.mustChangePassword?"Remplacez le mot de passe temporaire avant de continuer.":"Choisissez un nouveau mot de passe d’au moins 12 caractères.";
await copyToLocalProfile(user);
}

passwordForm.addEventListener("submit",async event=>{
event.preventDefault();status.textContent="Enregistrement…";
try{const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({currentPassword:document.getElementById("currentPassword").value,newPassword:document.getElementById("newPassword").value})});passwordForm.reset();await showUser(data.user);status.textContent="Nouveau mot de passe enregistré.";}catch(error){status.textContent=error.message;}
});

openPasswordChange.addEventListener("click",()=>{
passwordForm.hidden=!passwordForm.hidden;
openPasswordChange.textContent=passwordForm.hidden?"Changer mon mot de passe":"Annuler";
if(!passwordForm.hidden)document.getElementById("currentPassword").focus();
});

openEmailChange.addEventListener("click",()=>{
emailForm.hidden=!emailForm.hidden;
openEmailChange.textContent=emailForm.hidden?"Changer mon adresse email":"Annuler";
if(!emailForm.hidden){document.getElementById("newEmail").value=document.getElementById("accountEmailDisplay").textContent;document.getElementById("newEmail").focus();}
});

emailForm.addEventListener("submit",async event=>{
event.preventDefault();status.textContent="Modification de l’adresse…";
try{
const data=await request("/api/auth/me",{method:"PATCH",body:JSON.stringify({newEmail:document.getElementById("newEmail").value,currentPassword:document.getElementById("emailCurrentPassword").value})});
await showUser(data.user);localStorage.removeItem(TOKEN_KEY);status.textContent="Adresse modifiée. Reconnexion nécessaire…";
setTimeout(()=>location.replace("connexion.html"),900);
}catch(error){status.textContent=error.message;}
});

document.getElementById("accountLogout").addEventListener("click",async()=>{
if(window.EcuriePushIdentity)await Promise.race([window.EcuriePushIdentity.logout(),new Promise(resolve=>setTimeout(resolve,2200))]);
try{await request("/api/auth/logout",{method:"POST"});}catch(error){}
localStorage.removeItem(TOKEN_KEY);location.replace("connexion.html");
});

(async()=>{try{
const data=await request("/api/auth/me");
await showUser(data.user);
await Promise.all([showPaddockCard(),showLessonCards(),syncRemotePhoto().catch(()=>{})]);
}catch(error){localStorage.removeItem(TOKEN_KEY);location.replace("connexion.html");}})();
})();
