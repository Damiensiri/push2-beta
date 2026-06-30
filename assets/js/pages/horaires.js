/* ===== CONFIG ===== */

const SHEET_URL="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=horaires";
const EXCEPTIONS_URL="https://script.google.com/macros/s/AKfycbzWEB8PPqSQ4rinnTbh4414U3QPX836XtPOPBmKr0Bw2W4mRFWAl7Chv6WKHOjrcWoZew/exec?sheet=exceptions";

const REFRESH=60000;

let exceptions={};

/* ===== FORMAT JOUR ===== */

function capitalize(txt){
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* ===== FORMAT HEURE ===== */

function formatTime(val){

  if(!val) return "--:--";

  let d=new Date(val);

  if(!isNaN(d)){
    return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  }

  return String(val).substring(0,5);

}

/* ===== CHARGER EXCEPTIONS ===== */

function loadExceptions(){

fetch(EXCEPTIONS_URL+"&t="+Date.now(),{cache:"no-store"})
.then(r=>r.json())
.then(data=>{

  exceptions={};

  data.forEach(row=>{
    if(row.date){
      const d=new Date(row.date);
      const jour=d.toLocaleDateString("fr-FR",{weekday:"long"}).toLowerCase();
      exceptions[jour]=row.message;
    }
  });

});

}

/* ===== RENDER ===== */

function renderHoraires(data){

  const list=document.getElementById("list");
  list.innerHTML="";

  data.forEach(row=>{

    if(!row.jour) return;

    const card=document.createElement("div");
    card.className="card";

    let contenu;

    if(exceptions[row.jour]){
      contenu=exceptions[row.jour];
    }else{
      contenu=`${formatTime(row.ouvert)} - ${formatTime(row.ferme)}`;
    }

    card.innerHTML=`
      <img src="image/time.svg">
      <div class="day">${capitalize(row.jour)} :</div>
      <div class="time">${contenu}</div>
    `;

    list.appendChild(card);

  });

}

/* ===== LOAD ===== */

function loadHoraires(){

Promise.all([
fetch(SHEET_URL+"&t="+Date.now(),{cache:"no-store"}).then(r=>r.json()),
fetch(EXCEPTIONS_URL+"&t="+Date.now(),{cache:"no-store"}).then(r=>r.json())
])
.then(([horaires,exc])=>{

  exceptions={};

  exc.forEach(row=>{
    if(row.date){
      const d=new Date(row.date);
      const jour=d.toLocaleDateString("fr-FR",{weekday:"long"}).toLowerCase();
      exceptions[jour]=row.message;
    }
  });

  localStorage.setItem("horaires",JSON.stringify(horaires));

  renderHoraires(horaires);

});

}

/* ===== CACHE INSTANT ===== */

const cache=localStorage.getItem("horaires");

if(cache){
try{
renderHoraires(JSON.parse(cache));
}catch(e){}
}

/* ===== REFRESH ===== */

loadHoraires();
setInterval(loadHoraires,REFRESH);
