(function(){
  const elements={
    settingsButton:document.getElementById("settingsBtn"),
    settingsPanel:document.getElementById("settingsPanel"),
    apiUrl:document.getElementById("apiUrl"),
    token:document.getElementById("adminToken"),
    connect:document.getElementById("connectBtn"),
    forgetToken:document.getElementById("forgetTokenBtn"),
    connectionStatus:document.getElementById("connectionStatus"),
    form:document.getElementById("alertForm"),
    editingId:document.getElementById("editingId"),
    categorie:document.getElementById("categorie"),
    titre:document.getElementById("titre"),
    message:document.getElementById("message"),
    epingle:document.getElementById("epingle"),
    formTitle:document.getElementById("formTitle"),
    publish:document.getElementById("publishBtn"),
    send:document.getElementById("sendBtn"),
    cancel:document.getElementById("cancelEditBtn"),
    formStatus:document.getElementById("formStatus"),
    refresh:document.getElementById("refreshBtn"),
    list:document.getElementById("alertsList")
  };
  let alerts=[];

  const storedUrl=localStorage.getItem("notifications_beta_api_url")||
    "https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
  const storedToken=localStorage.getItem("notifications_beta_admin_token")||"";
  elements.apiUrl.value=storedUrl;
  elements.token.value=storedToken;

  function toggleSettings(force){
    const open=typeof force==="boolean"?force:elements.settingsPanel.hidden;
    elements.settingsPanel.hidden=!open;
    elements.settingsButton.setAttribute("aria-expanded",String(open));
  }

  function settings(){
    return{
      base:elements.apiUrl.value.trim().replace(/\/$/,""),
      token:elements.token.value
    };
  }

  async function api(path,options={}){
    const config=settings();
    if(!config.base)throw new Error("Adresse API manquante");
    if(!config.token)throw new Error("Jeton d’administration manquant");
    const response=await fetch(config.base+path,{
      ...options,
      headers:{
        "authorization":"Bearer "+config.token,
        ...(options.body?{"content-type":"application/json"}:{}),
        ...(options.headers||{})
      }
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Erreur ${response.status}`);
    return data;
  }

  function setStatus(element,message,type=""){
    element.textContent=message;
    element.className="status"+(type?" "+type:"");
  }

  async function loadAlerts(){
    setStatus(elements.connectionStatus,"Chargement…");
    try{
      const config=settings();
      localStorage.setItem("notifications_beta_api_url",config.base);
      alerts=await api("/api/admin/notifications");
      localStorage.setItem("notifications_beta_admin_token",config.token);
      render();
      setStatus(elements.connectionStatus,`${alerts.length} alerte(s) chargée(s).`,"success");
      toggleSettings(false);
    }catch(error){
      setStatus(elements.connectionStatus,error.message,"error");
    }
  }

  function render(){
    elements.list.replaceChildren();
    if(!alerts.length){
      const empty=document.createElement("p");
      empty.className="empty";
      empty.textContent="Aucune alerte enregistrée.";
      elements.list.appendChild(empty);
      return;
    }

    alerts.forEach(alert=>{
      const card=document.createElement("article");
      card.className="alert-item";
      const top=document.createElement("div");
      top.className="alert-top";
      const titleBox=document.createElement("div");
      const title=document.createElement("h3");
      title.textContent=alert.titre;
      const meta=document.createElement("p");
      meta.className="alert-meta";
      meta.textContent=`#${alert.id} · ${alert.date} à ${alert.heure}${alert.categorie?" · "+alert.categorie:""}`;
      titleBox.append(title,meta);
      top.appendChild(titleBox);

      const message=document.createElement("p");
      message.className="alert-message";
      message.textContent=NotificationFormat.toPlainText(alert.message);

      const badges=document.createElement("div");
      badges.className="badges";
      badges.append(
        badge(alert.active==="oui"?"Publiée":"Inactive",alert.active==="oui"?"active":"inactive"),
        badge(alert.epingle==="oui"?"Épinglée":"Non épinglée"),
        badge(alert.push_sent_at?"Push envoyé":alert.push_requested?"Push en attente (bêta)":"Sans push")
      );

      const edit=document.createElement("button");
      edit.type="button";
      edit.textContent="Modifier";
      edit.addEventListener("click",()=>startEdit(alert));
      const remove=document.createElement("button");
      remove.type="button";
      remove.className="danger";
      remove.textContent="Supprimer";
      remove.addEventListener("click",()=>deleteAlert(alert));
      const actions=document.createElement("div");
      actions.className="alert-actions";
      actions.append(edit,remove);
      card.append(top,message,badges,actions);
      elements.list.appendChild(card);
    });
  }

  async function deleteAlert(alert){
    if(!window.confirm(`Supprimer définitivement l’alerte #${alert.id} « ${alert.titre} » ?`))return;
    setStatus(elements.connectionStatus,"Suppression…");
    try{
      await api(`/api/admin/notifications/${alert.id}`,{method:"DELETE"});
      if(String(elements.editingId.value)===String(alert.id))resetForm();
      await loadAlerts();
      setStatus(elements.connectionStatus,"Alerte supprimée.","success");
    }catch(error){
      setStatus(elements.connectionStatus,error.message,"error");
    }
  }

  function badge(text,className=""){
    const node=document.createElement("span");
    node.className="badge"+(className?" "+className:"");
    node.textContent=text;
    return node;
  }

  function startEdit(alert){
    elements.editingId.value=alert.id;
    elements.categorie.value=alert.categorie||"";
    elements.titre.value=alert.titre;
    elements.message.value=alert.message;
    elements.epingle.checked=alert.epingle==="oui";
    elements.formTitle.textContent=`Modifier l’alerte #${alert.id}`;
    elements.cancel.hidden=false;
    elements.form.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function resetForm(){
    elements.form.reset();
    elements.editingId.value="";
    elements.formTitle.textContent="Nouvelle alerte";
    elements.cancel.hidden=true;
    setStatus(elements.formStatus,"");
  }

  elements.form.addEventListener("submit",async event=>{
    event.preventDefault();
    const id=elements.editingId.value;
    const sendPush=event.submitter?.value==="send";
    const payload={
      categorie:elements.categorie.value,
      titre:elements.titre.value,
      message:elements.message.value,
      epingle:elements.epingle.checked,
      active:true,
      pushRequested:sendPush
    };
    setStatus(elements.formStatus,"Enregistrement…");
    elements.publish.disabled=true;
    elements.send.disabled=true;
    try{
      const result=await api(id?`/api/admin/notifications/${id}`:"/api/admin/notifications",{
        method:id?"PATCH":"POST",
        body:JSON.stringify(payload)
      });
      resetForm();
      const pushMessages={
        sent:"Alerte enregistrée et push envoyé.",
        "already-sent":"Alerte enregistrée. Le push avait déjà été envoyé.",
        "not-requested":"Alerte enregistrée sans push.",
        "disabled-in-beta":"Alerte enregistrée. Le push bêta n’est pas encore activé.",
        failed:`Alerte enregistrée, mais le push a échoué${result.push?.error?" : "+result.push.error:"."}`
      };
      const pushFailed=result.push?.status==="failed";
      setStatus(elements.formStatus,pushMessages[result.push?.status]||"Alerte enregistrée.",pushFailed?"error":"success");
      await loadAlerts();
    }catch(error){
      setStatus(elements.formStatus,error.message,"error");
    }finally{
      elements.publish.disabled=false;
      elements.send.disabled=false;
    }
  });

  elements.connect.addEventListener("click",loadAlerts);
  elements.settingsButton.addEventListener("click",()=>toggleSettings());
  elements.forgetToken.addEventListener("click",()=>{
    localStorage.removeItem("notifications_beta_admin_token");
    elements.token.value="";
    setStatus(elements.connectionStatus,"Jeton oublié sur cet appareil.","success");
  });
  elements.refresh.addEventListener("click",loadAlerts);
  elements.cancel.addEventListener("click",resetForm);

  document.querySelectorAll("[data-format]").forEach(button=>{
    button.addEventListener("click",()=>applyFormat(button.dataset.format));
  });

  function replaceSelection(before,after,placeholder){
    const start=elements.message.selectionStart;
    const end=elements.message.selectionEnd;
    const selected=elements.message.value.slice(start,end)||placeholder;
    elements.message.setRangeText(before+selected+after,start,end,"select");
    elements.message.focus();
  }

  function applyFormat(format){
    if(format==="bold")replaceSelection("**","**","texte en gras");
    if(format==="underline")replaceSelection("__","__","texte souligné");
    if(format==="link"){
      const start=elements.message.selectionStart;
      const end=elements.message.selectionEnd;
      const selected=elements.message.value.slice(start,end);
      const label=selected||window.prompt("Texte du lien :","Voir le lien");
      if(!label)return;
      let url=window.prompt("Adresse du lien :","https://");
      if(!url)return;
      url=url.trim();
      if(!/^https?:\/\//i.test(url))url="https://"+url;
      try{
        const parsed=new URL(url);
        if(!["http:","https:"].includes(parsed.protocol))throw new Error();
        elements.message.setRangeText(`[${label}](${parsed.href})`,start,end,"end");
        elements.message.focus();
      }catch(error){
        window.alert("Adresse de lien invalide.");
      }
    }
  }

  if(storedToken){
    loadAlerts();
  }else{
    toggleSettings(true);
  }
})();
