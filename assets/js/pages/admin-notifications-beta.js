(function(){
  const elements={
    apiUrl:document.getElementById("apiUrl"),
    token:document.getElementById("adminToken"),
    connect:document.getElementById("connectBtn"),
    connectionStatus:document.getElementById("connectionStatus"),
    form:document.getElementById("alertForm"),
    editingId:document.getElementById("editingId"),
    categorie:document.getElementById("categorie"),
    titre:document.getElementById("titre"),
    message:document.getElementById("message"),
    epingle:document.getElementById("epingle"),
    active:document.getElementById("active"),
    pushRequested:document.getElementById("pushRequested"),
    formTitle:document.getElementById("formTitle"),
    save:document.getElementById("saveBtn"),
    cancel:document.getElementById("cancelEditBtn"),
    formStatus:document.getElementById("formStatus"),
    refresh:document.getElementById("refreshBtn"),
    list:document.getElementById("alertsList")
  };
  let alerts=[];

  const storedUrl=localStorage.getItem("notifications_beta_api_url")||
    "https://ecurie-notifications-beta.damiensiri-pro.workers.dev";
  elements.apiUrl.value=storedUrl;

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
      render();
      setStatus(elements.connectionStatus,`${alerts.length} alerte(s) chargée(s). Push désactivé.`,"success");
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
      message.textContent=alert.message;

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
      card.append(top,message,badges,edit);
      elements.list.appendChild(card);
    });
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
    elements.active.checked=alert.active==="oui";
    elements.pushRequested.checked=Boolean(alert.push_requested);
    elements.formTitle.textContent=`Modifier l’alerte #${alert.id}`;
    elements.save.textContent="Enregistrer les modifications";
    elements.cancel.hidden=false;
    elements.form.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function resetForm(){
    elements.form.reset();
    elements.editingId.value="";
    elements.active.checked=true;
    elements.formTitle.textContent="Nouvelle alerte";
    elements.save.textContent="Créer l’alerte";
    elements.cancel.hidden=true;
    setStatus(elements.formStatus,"");
  }

  elements.form.addEventListener("submit",async event=>{
    event.preventDefault();
    const id=elements.editingId.value;
    const payload={
      categorie:elements.categorie.value,
      titre:elements.titre.value,
      message:elements.message.value,
      epingle:elements.epingle.checked,
      active:elements.active.checked,
      pushRequested:elements.pushRequested.checked
    };
    setStatus(elements.formStatus,"Enregistrement…");
    elements.save.disabled=true;
    try{
      await api(id?`/api/admin/notifications/${id}`:"/api/admin/notifications",{
        method:id?"PATCH":"POST",
        body:JSON.stringify(payload)
      });
      resetForm();
      setStatus(elements.formStatus,"Alerte enregistrée. Aucun push envoyé.","success");
      await loadAlerts();
    }catch(error){
      setStatus(elements.formStatus,error.message,"error");
    }finally{
      elements.save.disabled=false;
    }
  });

  elements.connect.addEventListener("click",loadAlerts);
  elements.refresh.addEventListener("click",loadAlerts);
  elements.cancel.addEventListener("click",resetForm);
})();
