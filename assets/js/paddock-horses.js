/* Shared paddock selection/editor, using the caller's authenticated API. */
window.PaddockHorses={
  render(container,horses,selected=[]){
    container.replaceChildren();
    const hint=document.createElement('p');hint.textContent=horses.length?'Chevaux concernés (facultatif)':'Aucun cheval disponible. Vous pouvez réserver sans cheval.';container.append(hint);
    for(const horse of horses){const label=document.createElement('label'),input=document.createElement('input');
      input.style.cssText='width:auto;height:auto;min-width:18px;min-height:18px;accent-color:#BF4231';input.type='checkbox';input.value=horse.id;input.checked=selected.includes(Number(horse.id));
      label.style.cssText='display:inline-flex;align-items:center;gap:8px;margin:4px 12px 4px 0;padding:8px;border:1px solid #92a5ad;border-radius:10px';
      label.append(input,document.createTextNode(horse.name));container.append(label);
    }
  },
  selected(container){return [...container.querySelectorAll('input:checked')].map(input=>Number(input.value));},
  async edit({reservation,api,optionsPath,path,onSaved}){
    const dialog=document.createElement('dialog');dialog.style.cssText='width:min(440px,calc(100% - 32px));max-height:85dvh;overflow:auto;border:0;border-radius:20px;padding:24px;background:#fff;color:#17374a';
    dialog.innerHTML=`<form><h2>Modifier la réservation</h2><div style="display:grid;gap:12px"><label>Date <input name="date" type="date" required></label><label>Paddock <select name="paddock"><option value="maison">Maison</option><option value="grande">Grande voie</option><option value="beudot">Beudot</option></select></label><label>Heure <input name="time" type="time" step="1800" required></label><label>Durée <select name="duration"><option value="60">1 heure</option><option value="90">1 h 30</option></select></label></div><div data-horses></div><p role="status" aria-live="polite"></p><div style="display:flex;gap:12px"><button type="submit" disabled>Enregistrer</button><button type="button" data-close>Fermer</button></div></form>`;
    dialog.querySelectorAll('input,select,button').forEach(control=>control.style.cssText='font:inherit;padding:10px;border:1px solid #92a5ad;border-radius:8px;background:white;color:#17374a;max-width:100%');
    const form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]'),choices=dialog.querySelector('[data-horses]'),submit=dialog.querySelector('[type=submit]');
    for(const key of ['date','paddock','time','duration'])form.elements[key].value=reservation[key];
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
    document.body.append(dialog);dialog.showModal();status.textContent='Chargement des chevaux…';
    try{const result=await api(optionsPath);if(!dialog.isConnected)return;this.render(choices,result.horses||result.horseOptions||[],(reservation.horses||[]).map(h=>Number(h.id)));status.textContent='';submit.disabled=false;}catch(error){status.textContent=error.message;}
    form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;status.textContent='Enregistrement…';
      try{await api(path,{method:'PATCH',body:JSON.stringify({version:reservation.version,date:form.elements.date.value,paddock:form.elements.paddock.value,time:form.elements.time.value,duration:Number(form.elements.duration.value),horseIds:this.selected(choices)})});dialog.close();await onSaved();}
      catch(error){status.textContent=error.message;submit.disabled=false;}
    };
  }
};
