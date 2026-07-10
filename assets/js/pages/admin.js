(function initializeThemeAdmin(){
  const themes=window.APP_CONFIG?.themes || ["summer","autumn","christmas","winter","spring"];
  const themeConfigUrl=window.APP_CONFIG?.themeConfigUrl || "";
  const themeStorageKey=window.AppLayout?.themeStorageKey || "ecurie-active-theme-v1";
  const adminTokenKey="ecurie-theme-admin-token-v1";
  const form=document.getElementById("themeAdminForm");
  const themeSelect=document.getElementById("themeSelect");
  const adminToken=document.getElementById("adminToken");
  const status=document.getElementById("adminStatus");
  const currentTheme=document.getElementById("currentTheme");
  const refreshButton=document.getElementById("refreshThemeAdmin");

  function themeLabel(theme){
    return ({
      summer:"Summer",
      autumn:"Autumn",
      christmas:"Christmas",
      winter:"Winter",
      spring:"Spring"
    })[theme] || theme;
  }

  function setStatus(message,mode){
    if(!status)return;
    status.textContent=message;
    status.dataset.mode=mode || "";
  }

  function setCurrentTheme(theme,source){
    if(!themes.includes(theme))return;
    if(themeSelect)themeSelect.value=theme;
    if(currentTheme){
      currentTheme.textContent=themeLabel(theme);
      currentTheme.dataset.source=source || "";
    }
  }

  function readStoredTheme(){
    try{
      const raw=localStorage.getItem(themeStorageKey);
      if(!raw)return "";
      const value=JSON.parse(raw);
      const theme=typeof value==="string" ? value : value?.theme;
      return themes.includes(theme) ? theme : "";
    }catch(error){
      return "";
    }
  }

  function writeStoredTheme(theme){
    try{
      localStorage.setItem(themeStorageKey,JSON.stringify({
        theme,
        updatedAt:new Date().toISOString()
      }));
    }catch(error){}
  }

  function withCacheBust(url){
    try{
      const parsed=new URL(url,location.href);
      parsed.searchParams.set("_",String(Date.now()));
      return parsed.toString();
    }catch(error){
      return url+(url.includes("?")?"&":"?")+"_="+Date.now();
    }
  }

  async function requestThemeConfig(payload){
    if(!themeConfigUrl)throw new Error("Aucune URL Apps Script configurée.");

    const response=await fetch(withCacheBust(themeConfigUrl),payload ? {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(payload),
      cache:"no-store"
    } : {
      cache:"no-store"
    });

    if(!response.ok)throw new Error("Réponse admin invalide : "+response.status);

    const data=await response.json();
    if(data?.ok===false)throw new Error(data.error || "Action refusée.");
    return data;
  }

  async function loadRemoteTheme(){
    if(!themeConfigUrl){
      setStatus("Configuration distante non branchée. Il faut ajouter l’URL Apps Script dans app-config.js.","warning");
      return;
    }

    try{
      const data=await requestThemeConfig();
      const theme=data?.theme||data?.activeTheme||data?.currentTheme;
      if(themes.includes(theme)){
        setCurrentTheme(theme,"remote");
        writeStoredTheme(theme);
        window.AppLayout?.setLocalTheme?.(theme);
        setStatus("Thème actuellement publié : "+themeLabel(theme)+".","ok");
      }else{
        setStatus("La config distante répond, mais le thème reçu est inconnu.","warning");
      }
    }catch(error){
      const fallback=readStoredTheme() || window.AppLayout?.theme || window.APP_CONFIG?.theme || "summer";
      setCurrentTheme(fallback,"cache");
      setStatus("Impossible de joindre l’admin. Dernier thème connu conservé : "+themeLabel(fallback)+".","warning");
    }
  }

  form?.addEventListener("submit",async event=>{
    event.preventDefault();

    const theme=themeSelect?.value || "";
    const token=adminToken?.value.trim() || "";

    if(!themes.includes(theme)){
      setStatus("Choisis un thème valide.","error");
      return;
    }

    if(!themeConfigUrl){
      setStatus("Impossible de publier : l’URL Apps Script n’est pas encore configurée.","error");
      return;
    }

    if(adminToken && token){
      try{
        localStorage.setItem(adminTokenKey,token);
      }catch(error){}
    }

    setStatus("Publication du thème "+themeLabel(theme)+"…","pending");

    try{
      const data=await requestThemeConfig({
        action:"setTheme",
        theme,
        token
      });
      const publishedTheme=data?.theme||theme;
      writeStoredTheme(publishedTheme);
      window.AppLayout?.setLocalTheme?.(publishedTheme);
      setCurrentTheme(publishedTheme,"remote");
      setStatus("Thème publié : "+themeLabel(publishedTheme)+". Les appareils le récupéreront à l’ouverture ou au retour dans l’app.","ok");
    }catch(error){
      setStatus(error.message || "Publication impossible.","error");
    }
  });

  refreshButton?.addEventListener("click",()=>{
    setStatus("Lecture de la configuration distante…","pending");
    loadRemoteTheme();
  });

  if(adminToken){
    try{
      adminToken.value=localStorage.getItem(adminTokenKey)||"";
    }catch(error){}
  }

  setCurrentTheme(readStoredTheme() || window.AppLayout?.theme || window.APP_CONFIG?.theme || "summer","local");
  loadRemoteTheme();
})();
