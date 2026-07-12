(function(){
  "use strict";

  const sheet=document.getElementById("pwaInstallSheet");
  if(!sheet)return;

  const installButton=document.getElementById("pwaInstallAction");
  const installIntro=document.getElementById("pwaInstallIntro");
  const dismissButtons=sheet.querySelectorAll("[data-install-dismiss]");
  const DISMISS_KEY="pwa_install_dismissed_until";
  const INSTALLED_KEY="pwa_install_confirmed";
  const DISMISS_DAYS=7;
  const SHOW_DELAY=3600;
  const PROMPT_RETRY_DELAY=4200;
  const MAX_PROMPT_RETRIES=4;

  let deferredInstallPrompt=null;
  let hasShown=false;
  let retryCount=0;

  const standaloneQuery=window.matchMedia ? window.matchMedia("(display-mode: standalone)") : null;

  function isStandalone(){
    return Boolean(
      (standaloneQuery && standaloneQuery.matches) ||
      window.navigator.standalone === true
    );
  }

  function isIOS(){
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "") ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  }

  function isSamsungInternet(){
    return /SamsungBrowser/i.test(window.navigator.userAgent || "");
  }

  function isDismissed(){
    const until=Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  }

  function rememberDismissal(){
    const until=Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY,String(until));
  }

  function hideSheet(){
    sheet.classList.remove("is-visible");
    window.setTimeout(()=>{
      sheet.hidden=true;
    },260);
  }

  function visibleElement(selector){
    const elements=document.querySelectorAll(selector);
    return Array.from(elements).some(element=>{
      const rect=element.getBoundingClientRect();
      const style=window.getComputedStyle(element);
      return rect.width>0 && rect.height>0 && style.visibility!=="hidden" && style.display!=="none";
    });
  }

  function anotherPromptIsVisible(){
    return visibleElement(
      ".onesignal-slidedown-container,.onesignal-popover-container,.onesignal-customlink-container,iframe[src*='onesignal']"
    );
  }

  function canShow(){
    if(hasShown)return false;
    if(isStandalone())return false;
    if(isDismissed())return false;
    return true;
  }

  function showSheet(){
    if(!canShow())return;

    if(anotherPromptIsVisible()){
      if(retryCount < MAX_PROMPT_RETRIES){
        retryCount++;
        window.setTimeout(showSheet,PROMPT_RETRY_DELAY);
      }
      return;
    }

    hasShown=true;
    sheet.hidden=false;
    sheet.classList.toggle("pwa-install-sheet--ios",isIOS());
    sheet.classList.toggle("pwa-install-sheet--native",Boolean(deferredInstallPrompt));

    if(installIntro){
      if(isSamsungInternet()){
        installIntro.textContent="Pour une installation optimal, ouvrez cette page dans Google Chrome puis installez l’application. Vous pouvez aussi continuer ici si vous préférez.";
      }else{
        installIntro.textContent="Ouvrez l’écurie en plein écran, recevez les notifications en temps réel et gardez un accès rapide depuis votre écran d’accueil.";
      }
    }

    if(installButton){
      if(isIOS() || isSamsungInternet()){
        installButton.textContent="J’ai compris";
      }else if(deferredInstallPrompt){
        installButton.textContent="Installer l’application";
      }else{
        installButton.textContent="Voir plus tard";
      }
    }

    window.requestAnimationFrame(()=>{
      sheet.classList.add("is-visible");
    });
  }

  function scheduleShow(){
    if(!canShow())return;
    window.setTimeout(showSheet,SHOW_DELAY);
  }

  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    if(sheet.classList.contains("is-visible")){
      sheet.classList.add("pwa-install-sheet--native");
      if(installButton)installButton.textContent="Installer l’application";
    }
  });

  window.addEventListener("appinstalled",()=>{
    localStorage.setItem(INSTALLED_KEY,"1");
    hideSheet();
  });

  if(standaloneQuery && standaloneQuery.addEventListener){
    standaloneQuery.addEventListener("change",()=>{
      if(isStandalone()){
        localStorage.setItem(INSTALLED_KEY,"1");
        hideSheet();
      }
    });
  }

  dismissButtons.forEach(button=>{
    button.addEventListener("click",()=>{
      rememberDismissal();
      hideSheet();
    });
  });

  if(installButton){
    installButton.addEventListener("click",async()=>{
      if(isIOS() || isSamsungInternet() || !deferredInstallPrompt){
        rememberDismissal();
        hideSheet();
        return;
      }

      const promptEvent=deferredInstallPrompt;
      deferredInstallPrompt=null;
      promptEvent.prompt();

      try{
        const choice=await promptEvent.userChoice;
        if(choice && choice.outcome==="accepted"){
          localStorage.setItem(INSTALLED_KEY,"1");
        }else{
          rememberDismissal();
        }
      }catch(error){
        rememberDismissal();
      }

      hideSheet();
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",scheduleShow,{once:true});
  }else{
    scheduleShow();
  }
})();
