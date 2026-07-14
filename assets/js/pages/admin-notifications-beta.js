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
    list:document.getElementById("alertsList"),
    refreshSpaces:document.getElementById("refreshSpacesBtn"),
    spacePills:document.getElementById("spacePills"),
    spaceListStatus:document.getElementById("spaceListStatus"),
    spaceEditor:document.getElementById("spaceEditor"),
    spaceEditorTitle:document.getElementById("spaceEditorTitle"),
    closeSpaceEditor:document.getElementById("closeSpaceEditorBtn"),
    spaceSelect:document.getElementById("spaceSelect"),
    spaceSpecial:document.getElementById("spaceSpecial"),
    spaceInfo:document.getElementById("spaceInfo"),
    saveSpace:document.getElementById("saveSpaceBtn"),
    spaceMessage:document.getElementById("spaceStatusMessage"),
    spaceSchedules:document.getElementById("spaceSchedules"),
    saveSpaceSchedules:document.getElementById("saveSpaceSchedulesBtn"),
    spaceSchedulesStatus:document.getElementById("spaceSchedulesStatus"),
    generalSchedules:document.getElementById("generalSchedules"),
    saveGeneralSchedules:document.getElementById("saveGeneralSchedulesBtn"),
    generalSchedulesStatus:document.getElementById("generalSchedulesStatus"),
    exceptionDate:document.getElementById("exceptionDate"),
    exceptionMessage:document.getElementById("exceptionMessage"),
    saveException:document.getElementById("saveExceptionBtn"),
    exceptionStatus:document.getElementById("exceptionStatus"),
    exceptionsList:document.getElementById("exceptionsList"),
    homeAlertMessage:document.getElementById("homeAlertMessage"),
    homeAlertUrgent:document.getElementById("homeAlertUrgent"),
    saveHomeAlert:document.getElementById("saveHomeAlertBtn"),
    homeAlertStatus:document.getElementById("homeAlertStatus")
  };
  let alerts=[];
  let operations={spaces:[],spaceSchedules:[],generalSchedules:[],exceptions:[],homeAlert:{}};
  let publicStatuses=[];
  let liveRefreshTimer=null;
  const days=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];

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

  async function loadAll(){
    setStatus(elements.connectionStatus,"Chargement…");
    try{
      const config=settings();
      localStorage.setItem("notifications_beta_api_url",config.base);
      [alerts,operations,publicStatuses]=await Promise.all([
        api("/api/admin/notifications"),
        api("/api/admin/operations"),
        fetch(config.base+"/api/statuses",{cache:"no-store"}).then(response=>response.json())
      ]);
      localStorage.setItem("notifications_beta_admin_token",config.token);
      render();
      renderOperations();
      setStatus(elements.connectionStatus,"Administration connectée.","success");
      toggleSettings(false);
    }catch(error){
      setStatus(elements.connectionStatus,error.message,"error");
      toggleSettings(true);
    }
  }

  function renderOperations(){
    const selected=elements.spaceSelect.value||operations.spaces[0]?.slug||"";
    elements.spaceSelect.replaceChildren(...operations.spaces.map(space=>{
      const option=document.createElement("option");
      option.value=space.slug;
      option.textContent=space.label;
      return option;
    }));
    if(operations.spaces.some(space=>space.slug===selected))elements.spaceSelect.value=selected;
    renderSpacePills();
    renderSelectedSpace();
    renderScheduleInputs(elements.generalSchedules,operations.generalSchedules);
    renderExceptions();
    elements.homeAlertMessage.value=operations.homeAlert?.message||"";
    elements.homeAlertUrgent.checked=operations.homeAlert?.urgent==="oui";
  }

  function renderSpacePills(){
    elements.spacePills.replaceChildren();
    const jsDay=new Date().getDay();
    const day=jsDay===0?7:jsDay;
    operations.spaces.forEach(space=>{
      const current=publicStatuses.find(item=>item.espace===space.slug)||{};
      const schedule=operations.spaceSchedules.find(item=>item.space_slug===space.slug&&Number(item.day)===day);
      const pill=document.createElement("article");
      pill.className="space-pill";

      const summary=document.createElement("div");
      summary.className="space-summary";
      const name=document.createElement("strong");
      name.textContent=space.label;
      const detail=document.createElement("span");
      const statusLabel={ouvert:"Ouvert",prevision:"Prévision",ferme:"Fermé","hors-service":"Hors service"}[current.statut_auto||space.manual_status]||"—";
      const hours=schedule?`${schedule.opens_at}–${schedule.closes_at}`:"—";
      detail.textContent=`${statusLabel} / ${hours}${space.info?"  💬":""}`;
      summary.append(name,detail);

      const open=document.createElement("button");
      open.type="button";
      open.className="space-chevron";
      open.textContent="›";
      open.setAttribute("aria-label",`Modifier ${space.label}`);
      open.addEventListener("click",()=>openSpaceEditor(space.slug));

      const head=document.createElement("div");
      head.className="space-pill-head";
      head.append(summary,open);
      pill.appendChild(head);

      const statuses=document.createElement("div");
      statuses.className="quick-actions status-actions";
      [
        ["ouvert","Auto"],["prevision","Prévision"],["ferme","Fermé"],["hors-service","HS"]
      ].forEach(([value,label])=>{
        const button=document.createElement("button");
        button.type="button";
        button.textContent=label;
        button.classList.toggle("selected",space.manual_status===value);
        button.addEventListener("click",()=>quickSaveSpace(space,{manualStatus:value}));
        statuses.appendChild(button);
      });
      pill.appendChild(statuses);

      if(space.slug==="carriere"||space.slug==="manege"){
        const options=document.createElement("div");
        options.className="quick-options";
        options.append(
          quickToggle(space,"Liberté","liberte"),
          quickToggle(space,"Longe","longe")
        );
        pill.appendChild(options);
      }
      elements.spacePills.appendChild(pill);
    });
  }

  function quickToggle(space,label,field){
    const wrapper=document.createElement("div");
    wrapper.className="quick-toggle";
    const name=document.createElement("span");
    name.textContent=label;
    wrapper.appendChild(name);
    ["oui","non"].forEach(value=>{
      const button=document.createElement("button");
      button.type="button";
      button.textContent=value.toUpperCase();
      button.classList.toggle("selected",space[field]===value);
      button.addEventListener("click",()=>quickSaveSpace(space,{[field]:value}));
      wrapper.appendChild(button);
    });
    return wrapper;
  }

  async function quickSaveSpace(space,changes){
    setStatus(elements.spaceListStatus,`Mise à jour de ${space.label}…`);
    try{
      await api(`/api/admin/spaces/${space.slug}`,{
        method:"PUT",
        body:JSON.stringify({
          manualStatus:changes.manualStatus??space.manual_status,
          liberte:changes.liberte??space.liberte,
          longe:changes.longe??space.longe,
          specialHours:space.special_hours,
          info:space.info
        })
      });
      await refreshOperations();
      setStatus(elements.spaceListStatus,`${space.label} mis à jour.`,"success");
    }catch(error){setStatus(elements.spaceListStatus,error.message,"error");}
  }

  function openSpaceEditor(slug){
    elements.spaceSelect.value=slug;
    renderSelectedSpace();
    const space=operations.spaces.find(item=>item.slug===slug);
    elements.spaceEditorTitle.textContent=`Modifier ${space?.label||"l’espace"}`;
    elements.spaceEditor.hidden=false;
    elements.spaceEditor.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function renderSelectedSpace(){
    const slug=elements.spaceSelect.value;
    const space=operations.spaces.find(item=>item.slug===slug);
    if(!space)return;
    elements.spaceSpecial.value=space.special_hours||"";
    elements.spaceInfo.value=space.info||"";
    renderScheduleInputs(elements.spaceSchedules,
      operations.spaceSchedules.filter(item=>item.space_slug===slug));
    setStatus(elements.spaceMessage,"");
    setStatus(elements.spaceSchedulesStatus,"");
  }

  function renderScheduleInputs(container,rows){
    container.replaceChildren();
    days.forEach((label,index)=>{
      const day=index+1;
      const row=rows.find(item=>Number(item.day)===day)||{};
      const wrapper=document.createElement("div");
      wrapper.className="schedule-row";
      const name=document.createElement("strong");
      name.textContent=label;
      const open=document.createElement("input");
      open.type="time";
      open.value=row.opens_at||"08:00";
      open.dataset.day=String(day);
      open.dataset.kind="open";
      open.setAttribute("aria-label",`Ouverture ${label}`);
      const close=document.createElement("input");
      close.type="time";
      close.value=row.closes_at||"21:00";
      close.dataset.day=String(day);
      close.dataset.kind="close";
      close.setAttribute("aria-label",`Fermeture ${label}`);
      wrapper.append(name,open,close);
      container.appendChild(wrapper);
    });
  }

  function readScheduleInputs(container){
    return days.map((_,index)=>{
      const day=index+1;
      return{
        day,
        opensAt:container.querySelector(`[data-day="${day}"][data-kind="open"]`).value,
        closesAt:container.querySelector(`[data-day="${day}"][data-kind="close"]`).value
      };
    });
  }

  function renderExceptions(){
    elements.exceptionsList.replaceChildren();
    if(!operations.exceptions.length){
      const empty=document.createElement("p");
      empty.className="empty";
      empty.textContent="Aucune exception enregistrée.";
      elements.exceptionsList.appendChild(empty);
      return;
    }
    operations.exceptions.forEach(item=>{
      const row=document.createElement("article");
      row.className="exception-item";
      const text=document.createElement("div");
      const title=document.createElement("strong");
      title.textContent=item.date;
      const message=document.createElement("p");
      message.textContent=item.message;
      text.append(title,message);
      const remove=document.createElement("button");
      remove.type="button";
      remove.className="danger compact";
      remove.textContent="Supprimer";
      remove.addEventListener("click",()=>deleteException(item));
      row.append(text,remove);
      elements.exceptionsList.appendChild(row);
    });
  }

  async function refreshOperations(){
    const config=settings();
    [operations,publicStatuses]=await Promise.all([
      api("/api/admin/operations"),
      fetch(config.base+"/api/statuses",{cache:"no-store"}).then(response=>response.json())
    ]);
    renderOperations();
  }

  async function refreshOperationsWithFeedback(message="Données actualisées."){
    setStatus(elements.spaceListStatus,"Actualisation…");
    try{
      await refreshOperations();
      setStatus(elements.spaceListStatus,message,"success");
    }catch(error){
      setStatus(elements.spaceListStatus,error.message,"error");
    }
  }

  async function deleteException(item){
    if(!window.confirm(`Supprimer l’exception du ${item.date} ?`))return;
    try{
      await api(`/api/admin/exceptions/${item.id}`,{method:"DELETE"});
      await refreshOperations();
      setStatus(elements.exceptionStatus,"Exception supprimée.","success");
    }catch(error){setStatus(elements.exceptionStatus,error.message,"error");}
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

  elements.connect.addEventListener("click",loadAll);
  elements.settingsButton.addEventListener("click",()=>toggleSettings());
  elements.forgetToken.addEventListener("click",()=>{
    localStorage.removeItem("notifications_beta_admin_token");
    elements.token.value="";
    setStatus(elements.connectionStatus,"Jeton oublié sur cet appareil.","success");
  });
  elements.refresh.addEventListener("click",loadAlerts);
  elements.refreshSpaces.addEventListener("click",()=>refreshOperationsWithFeedback());
  elements.cancel.addEventListener("click",resetForm);

  document.querySelectorAll("[data-section-button]").forEach(button=>{
    button.addEventListener("click",()=>{
      document.querySelectorAll("[data-section-button]").forEach(item=>item.classList.toggle("active",item===button));
      document.querySelectorAll("[data-admin-section]").forEach(section=>{
        section.hidden=section.dataset.adminSection!==button.dataset.sectionButton;
      });
    });
  });

  elements.spaceSelect.addEventListener("change",renderSelectedSpace);
  elements.closeSpaceEditor.addEventListener("click",()=>{
    elements.spaceEditor.hidden=true;
  });
  elements.saveSpace.addEventListener("click",async()=>{
    const slug=elements.spaceSelect.value;
    const space=operations.spaces.find(item=>item.slug===slug);
    if(!space)return;
    setStatus(elements.spaceMessage,"Enregistrement…");
    try{
      await api(`/api/admin/spaces/${slug}`,{
        method:"PUT",
        body:JSON.stringify({
          manualStatus:space.manual_status,
          liberte:space.liberte,
          longe:space.longe,
          specialHours:elements.spaceSpecial.value,
          info:elements.spaceInfo.value
        })
      });
      await refreshOperations();
      elements.spaceSelect.value=slug;
      renderSelectedSpace();
      setStatus(elements.spaceMessage,"Informations enregistrées.","success");
    }catch(error){setStatus(elements.spaceMessage,error.message,"error");}
  });

  elements.saveSpaceSchedules.addEventListener("click",async()=>{
    const slug=elements.spaceSelect.value;
    setStatus(elements.spaceSchedulesStatus,"Enregistrement…");
    try{
      await api(`/api/admin/spaces/${slug}/schedules`,{
        method:"PUT",body:JSON.stringify({schedules:readScheduleInputs(elements.spaceSchedules)})
      });
      await refreshOperations();
      elements.spaceSelect.value=slug;
      renderSelectedSpace();
      setStatus(elements.spaceSchedulesStatus,"Horaires enregistrés.","success");
    }catch(error){setStatus(elements.spaceSchedulesStatus,error.message,"error");}
  });

  elements.saveGeneralSchedules.addEventListener("click",async()=>{
    setStatus(elements.generalSchedulesStatus,"Enregistrement…");
    try{
      await api("/api/admin/general-schedules",{
        method:"PUT",body:JSON.stringify({schedules:readScheduleInputs(elements.generalSchedules)})
      });
      await refreshOperations();
      setStatus(elements.generalSchedulesStatus,"Horaires des écuries enregistrés.","success");
    }catch(error){setStatus(elements.generalSchedulesStatus,error.message,"error");}
  });

  elements.saveException.addEventListener("click",async()=>{
    setStatus(elements.exceptionStatus,"Enregistrement…");
    try{
      await api("/api/admin/exceptions",{
        method:"POST",body:JSON.stringify({date:elements.exceptionDate.value,message:elements.exceptionMessage.value})
      });
      elements.exceptionMessage.value="";
      await refreshOperations();
      setStatus(elements.exceptionStatus,"Exception enregistrée.","success");
    }catch(error){setStatus(elements.exceptionStatus,error.message,"error");}
  });

  elements.saveHomeAlert.addEventListener("click",async()=>{
    setStatus(elements.homeAlertStatus,"Enregistrement…");
    try{
      await api("/api/admin/home-alert",{
        method:"PUT",body:JSON.stringify({message:elements.homeAlertMessage.value,urgent:elements.homeAlertUrgent.checked})
      });
      await refreshOperations();
      setStatus(elements.homeAlertStatus,"Alerte d’accueil enregistrée.","success");
    }catch(error){setStatus(elements.homeAlertStatus,error.message,"error");}
  });

  document.querySelectorAll("[data-format]").forEach(button=>{
    button.addEventListener("click",()=>applyFormat(button.dataset.format));
  });

  window.addEventListener("pwa-data-changed",()=>{
    if(!elements.token.value)return;
    clearTimeout(liveRefreshTimer);
    liveRefreshTimer=setTimeout(()=>refreshOperationsWithFeedback("Mis à jour en direct."),150);
  });

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"&&elements.token.value){
      refreshOperationsWithFeedback("Données synchronisées.");
    }
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
    loadAll();
  }else{
    toggleSettings(true);
  }
})();
