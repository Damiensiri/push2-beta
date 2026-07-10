(function initializeThemeAdmin(){
  const storageKey=window.AppLayout?.adminStorageKey || "ecurie-theme-admin-v1";
  const themes=window.APP_CONFIG?.themes || ["summer","autumn","christmas","winter","spring"];
  const form=document.getElementById("themeAdminForm");
  const themeMode=document.getElementById("themeMode");
  const themeSelect=document.getElementById("themeSelect");
  const daypartMode=document.getElementById("daypartMode");
  const daypartSelect=document.getElementById("daypartSelect");
  const resetButton=document.getElementById("resetThemeAdmin");
  const status=document.getElementById("adminStatus");

  function readSettings(){
    try{
      const raw=localStorage.getItem(storageKey);
      if(!raw)return {};
      const value=JSON.parse(raw);
      return value && typeof value==="object" ? value : {};
    }catch(error){
      return {};
    }
  }

  function writeSettings(settings){
    localStorage.setItem(storageKey,JSON.stringify(settings));
  }

  function fillForm(){
    const settings=readSettings();
    themeMode.value=settings.themeMode==="force" ? "force" : "auto";
    themeSelect.value=themes.includes(settings.theme) ? settings.theme : (window.AppLayout?.theme || window.APP_CONFIG?.theme || "summer");
    daypartMode.value=settings.daypartMode==="force" ? "force" : "auto";
    daypartSelect.value=["dawn","day","sunset","night"].includes(settings.daypart) ? settings.daypart : (document.documentElement.dataset.daypart || "day");
  }

  function updateStatus(message){
    if(status)status.textContent=message;
  }

  form?.addEventListener("submit",event=>{
    event.preventDefault();
    writeSettings({
      themeMode:themeMode.value,
      theme:themeSelect.value,
      daypartMode:daypartMode.value,
      daypart:daypartSelect.value,
      updatedAt:new Date().toISOString()
    });
    updateStatus("Réglage enregistré sur cet appareil. Rechargement…");
    setTimeout(()=>location.reload(),350);
  });

  resetButton?.addEventListener("click",()=>{
    localStorage.removeItem(storageKey);
    updateStatus("Mode automatique restauré. Rechargement…");
    setTimeout(()=>location.reload(),350);
  });

  fillForm();
})();
