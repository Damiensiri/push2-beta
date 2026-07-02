(function initializeBottomNavigation(){
  const componentScript=document.currentScript;
  const componentVersion=componentScript
    ? new URL(componentScript.src,location.href).searchParams.get("v")
    : "";
  const items=[
    {
      id:"home",
      label:"Accueil",
      href:"index.html",
      pages:["index.html"],
      icon:'<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 10.3v9.2h13v-9.2"/><path d="M9.5 19.5v-5.7h5v5.7"/>'
    },
    {
      id:"notifications",
      label:"Notifications",
      href:"notifications.html",
      pages:["notifications.html","detail.html"],
      icon:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'
    },
    {
      id:"plan",
      label:"Plan",
      href:"plan.html",
      pages:["plan.html"],
      icon:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>'
    },
    {
      id:"reservations",
      label:"Mes réservations",
      href:"mesreservations.html",
      pages:["mesreservations.html"],
      icon:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'
    }
  ];

  function currentPage(){
    const page=location.pathname.split("/").pop();
    return page || "index.html";
  }

  function iconMarkup(paths){
    return '<span class="bottom-nav__icon" aria-hidden="true">'+
      '<svg viewBox="0 0 24 24" fill="none">'+paths+"</svg>"+
      "</span>";
  }

  function versionedHref(href){
    if(!componentVersion)return href;
    return href+"?v="+encodeURIComponent(componentVersion);
  }

  function labelMarkup(label){
    const labelElement=document.createElement("span");
    labelElement.className="bottom-nav__label";
    labelElement.textContent=label;
    return labelElement;
  }

  function createStandardItem(item,page){
    const link=document.createElement("a");
    link.className="bottom-nav__item";
    link.dataset.navId=item.id;
    link.href=versionedHref(item.href);
    link.setAttribute("aria-label",item.label);
    link.innerHTML=iconMarkup(item.icon);
    link.appendChild(labelMarkup(item.label));

    if(item.pages.includes(page)){
      link.classList.add("bottom-nav__item--active");
      link.setAttribute("aria-current","page");
    }

    return link;
  }

  function prepareExistingBell(item){
    const bell=document.getElementById("bellBox");

    if(!bell)return null;

    [...bell.childNodes].forEach(node=>{
      if(node.nodeType===3 && node.textContent.trim()){
        node.remove();
      }
    });

    if(!bell.querySelector(".bottom-nav__icon")){
      bell.insertAdjacentHTML("afterbegin",iconMarkup(item.icon));
    }

    if(!bell.querySelector(".bottom-nav__label")){
      bell.appendChild(labelMarkup(item.label));
    }

    bell.classList.add("bottom-nav__bell");
    bell.setAttribute("aria-label",item.label);
    return bell;
  }

  function createUserPreview(){
    if(!document.body.classList.contains("index-page"))return;
    if(document.querySelector(".user-preview"))return;

    const header=document.querySelector("body.index-page > header");
    if(!header)return;

    const preview=document.createElement("div");
    preview.className="user-preview";
    preview.setAttribute("aria-label","Emplacement utilisateur à venir");
    preview.innerHTML=
      '<span class="user-preview__avatar" aria-hidden="true">'+
        '<svg viewBox="0 0 24 24" fill="none">'+
          '<circle cx="12" cy="8" r="3.2"/>'+
          '<path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6"/>'+
        "</svg>"+
      "</span>"+
      '<span class="user-preview__label">Prénom</span>';
    header.appendChild(preview);
  }

  function updateOverlayState(){
    const overlayOpen=Boolean(document.querySelector(
      "#panel.active,#cartPanel.open,#confirmSheet.show"
    ));
    document.body.classList.toggle("bottom-nav-overlay-open",overlayOpen);
  }

  function observeOverlays(){
    const observer=new MutationObserver(updateOverlayState);
    observer.observe(document.body,{
      subtree:true,
      attributes:true,
      attributeFilter:["class"]
    });
    updateOverlayState();
  }

  function observeFormFocus(){
    document.addEventListener("focusin",event=>{
      if(event.target.matches("input,textarea,select")){
        document.body.classList.add("bottom-nav-input-active");
      }
    });

    document.addEventListener("focusout",event=>{
      if(event.target.matches("input,textarea,select")){
        requestAnimationFrame(()=>{
          const active=document.activeElement;
          const formActive=active && active.matches("input,textarea,select");
          document.body.classList.toggle("bottom-nav-input-active",formActive);
        });
      }
    });
  }

  function buildBottomNavigation(){
    if(document.querySelector(".bottom-nav"))return;

    const page=currentPage();
    const nav=document.createElement("nav");
    nav.className="bottom-nav";
    nav.setAttribute("aria-label","Accès rapides");

    items.forEach(item=>{
      if(item.id==="notifications" && page==="index.html"){
        const bell=prepareExistingBell(item);

        if(bell){
          nav.appendChild(bell);
          return;
        }
      }

      nav.appendChild(createStandardItem(item,page));
    });

    document.body.appendChild(nav);
    document.body.classList.add("has-bottom-nav");
    createUserPreview();
    observeOverlays();
    observeFormFocus();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",buildBottomNavigation);
  }else{
    buildBottomNavigation();
  }
})();
