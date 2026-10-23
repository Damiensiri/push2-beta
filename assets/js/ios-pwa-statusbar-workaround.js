(function initializeIosPwaStatusbarWorkaround(){
  "use strict";

  const config=window.APP_CONFIG||{};
  const isStandalone=navigator.standalone===true||window.matchMedia?.("(display-mode: standalone)").matches===true;
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||
    (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);

  if(config.IOS_PWA_STATUSBAR_WORKAROUND!==true||!isIOS||!isStandalone)return;

  const moduleVersion=(()=>{
    try{return new URL(document.currentScript?.src||"",location.href).searchParams.get("v")||"current";}
    catch(error){return"current";}
  })();
  if(!document.querySelector('link[data-ios-pwa-statusbar-experiment]')){
    const stylesheet=document.createElement("link");
    stylesheet.rel="stylesheet";
    stylesheet.href=`assets/css/ios-pwa-statusbar-workaround.css?v=${encodeURIComponent(moduleVersion)}`;
    stylesheet.dataset.iosPwaStatusbarExperiment="";
    document.head.appendChild(stylesheet);
  }

  const storageKey="ecurie-beta-ios-pwa-statusbar-workaround-mode-v1";
  const modes=Object.freeze(["original","transparent","solid"]);
  const labels=Object.freeze({
    original:"Original",
    transparent:"Sonde transparente (1 %)",
    solid:"Couleur unie (témoin)"
  });

  function validMode(value){
    return modes.includes(value)?value:"original";
  }

  function storedMode(){
    try{return validMode(localStorage.getItem(storageKey)||"original");}
    catch(error){return"original";}
  }

  const activeMode=storedMode();

  if(activeMode!=="original"){
    const probe=document.createElement("div");
    probe.id="ios-pwa-statusbar-compositor-probe";
    probe.dataset.mode=activeMode;
    probe.setAttribute("aria-hidden","true");
    document.documentElement.appendChild(probe);
  }

  function safeAreaTop(){
    const measure=document.createElement("div");
    measure.style.cssText="position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)";
    document.documentElement.appendChild(measure);
    const value=getComputedStyle(measure).paddingTop;
    measure.remove();
    return value;
  }

  function number(value){
    return Number.isFinite(value)?Math.round(value*100)/100:null;
  }

  function measurements(){
    const viewport=window.visualViewport;
    const orientation=screen.orientation;
    return {
      capturedAt:new Date().toISOString(),
      activeMode,
      nextLaunchMode:storedMode(),
      iosDetected:isIOS,
      navigatorStandalone:navigator.standalone===true,
      displayModeStandalone:window.matchMedia?.("(display-mode: standalone)").matches===true,
      innerWidth:window.innerWidth,
      innerHeight:window.innerHeight,
      screenWidth:screen.width,
      screenHeight:screen.height,
      devicePixelRatio:window.devicePixelRatio,
      safeAreaInsetTop:safeAreaTop(),
      visualViewport:viewport?{
        width:number(viewport.width),
        height:number(viewport.height),
        offsetTop:number(viewport.offsetTop),
        offsetLeft:number(viewport.offsetLeft),
        pageTop:number(viewport.pageTop),
        scale:number(viewport.scale)
      }:null,
      orientation:orientation?{
        type:orientation.type,
        angle:orientation.angle
      }:null,
      theme:document.documentElement.dataset.theme||document.body?.dataset.theme||null,
      daypart:document.documentElement.dataset.daypart||document.body?.dataset.daypart||null,
      visibility:document.visibilityState,
      userAgent:navigator.userAgent
    };
  }

  function setStoredMode(mode){
    const nextMode=validMode(mode);
    try{
      localStorage.setItem(storageKey,nextMode);
      return true;
    }catch(error){
      return false;
    }
  }

  function openDiagnostic(){
    if(document.getElementById("ios-pwa-statusbar-diagnostic"))return;

    const root=document.createElement("section");
    root.id="ios-pwa-statusbar-diagnostic";
    root.setAttribute("role","dialog");
    root.setAttribute("aria-modal","true");
    root.setAttribute("aria-labelledby","ios-statusbar-diagnostic-title");
    root.innerHTML=`
      <div class="ios-statusbar-diagnostic__panel">
        <h2 id="ios-statusbar-diagnostic-title" tabindex="-1">Diagnostic barre d’état iOS</h2>
        <p>Mode actif à ce lancement : <strong data-active-mode></strong></p>
        <p>Mode prévu au prochain lancement : <strong data-next-mode></strong></p>
        <div class="ios-statusbar-diagnostic__notice" role="note">
          Le choix n’est pas appliqué immédiatement. Fermez complètement la PWA depuis le sélecteur d’applications, puis relancez-la. Une variation affichée dans ce panneau ne constitue pas une preuve de correction.
        </div>
        <h3>Mode du prochain lancement</h3>
        <div class="ios-statusbar-diagnostic__modes">
          <button type="button" data-mode="original">Original — aucune sonde</button>
          <button type="button" data-mode="transparent">Sonde transparente — bleu à 1 %</button>
          <button type="button" data-mode="solid">Couleur unie — témoin bleu</button>
        </div>
        <p data-save-status aria-live="polite"></p>
        <h3>Mesures</h3>
        <pre data-measurements></pre>
        <div class="ios-statusbar-diagnostic__actions">
          <button type="button" data-refresh>Actualiser les mesures</button>
          <button type="button" data-copy>Copier les mesures</button>
          <button type="button" data-close>Fermer le panneau</button>
        </div>
      </div>`;

    const activeOutput=root.querySelector("[data-active-mode]");
    const nextOutput=root.querySelector("[data-next-mode]");
    const statusOutput=root.querySelector("[data-save-status]");
    const measurementsOutput=root.querySelector("[data-measurements]");

    function render(){
      const nextMode=storedMode();
      activeOutput.textContent=labels[activeMode];
      nextOutput.textContent=labels[nextMode];
      root.querySelectorAll("[data-mode]").forEach(button=>{
        button.setAttribute("aria-pressed",String(button.dataset.mode===nextMode));
      });
      measurementsOutput.textContent=JSON.stringify(measurements(),null,2);
    }

    root.addEventListener("click",async event=>{
      const modeButton=event.target.closest("[data-mode]");
      if(modeButton){
        const saved=setStoredMode(modeButton.dataset.mode);
        statusOutput.textContent=saved
          ?`Mode « ${labels[storedMode()]} » enregistré. Il sera actif après fermeture complète et relance.`
          :"Impossible d’enregistrer le mode sur cet appareil.";
        render();
        return;
      }
      if(event.target.closest("[data-refresh]")){
        render();
        return;
      }
      if(event.target.closest("[data-copy]")){
        const text=measurementsOutput.textContent;
        try{
          await navigator.clipboard.writeText(text);
          statusOutput.textContent="Mesures copiées.";
        }catch(error){
          statusOutput.textContent="Copie automatique indisponible : maintenez le doigt sur les mesures pour les copier.";
        }
        return;
      }
      if(event.target.closest("[data-close]"))root.remove();
    });

    document.body.appendChild(root);
    render();
    root.querySelector("h2").focus();
  }

  let tapCount=0;
  let lastTap=0;
  document.addEventListener("click",event=>{
    if(!event.target.closest(".app-version"))return;
    const now=Date.now();
    tapCount=now-lastTap<900?tapCount+1:1;
    lastTap=now;
    if(tapCount>=5){
      tapCount=0;
      openDiagnostic();
    }
  });

  if(new URLSearchParams(location.search).get("ios-statusbar-diagnostic")==="1"){
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",openDiagnostic,{once:true});
    else openDiagnostic();
  }

  window.IOSPWAStatusbarDiagnostic=Object.freeze({
    activeMode,
    get nextLaunchMode(){return storedMode();},
    open:openDiagnostic,
    measurements
  });
})();
