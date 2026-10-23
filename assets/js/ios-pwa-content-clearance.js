(function initializeIosPwaContentClearance(){
  const requestedValue=Number(window.APP_CONFIG?.IOS_PWA_CONTENT_CLEARANCE_PX)||0;
  const clearance=Math.max(0,Math.min(40,requestedValue));
  if(clearance===0)return;

  const isIos=/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  const isStandalone=window.matchMedia("(display-mode: standalone)").matches
    || navigator.standalone===true;
  if(!isIos||!isStandalone)return;

  const currentScriptUrl=document.currentScript?.src||window.location.href;
  const version=(()=>{
    try{return new URL(currentScriptUrl,window.location.href).searchParams.get("v")||"current";}
    catch(error){return"current";}
  })();

  document.documentElement.style.setProperty("--ios-pwa-content-clearance",`${clearance}px`);
  document.documentElement.classList.add("ios-pwa-content-clearance");

  if(document.querySelector('link[data-ios-pwa-content-clearance]'))return;
  const stylesheet=document.createElement("link");
  stylesheet.rel="stylesheet";
  stylesheet.href=new URL(`../css/ios-pwa-content-clearance.css?v=${encodeURIComponent(version)}`,currentScriptUrl).href;
  stylesheet.dataset.iosPwaContentClearance="";
  document.head.appendChild(stylesheet);
})();
