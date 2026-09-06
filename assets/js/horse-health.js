(() => {
 const types={vaccine:'Vaccination',deworming:'Vermifuge',farriery:'Ferrure / parage',dental:'Dentiste'};
 const dueOptions={vaccine:[['1 mois',1,0],['6 mois',6,0],['1 an',12,0]],deworming:[],farriery:[['5 semaines',0,35],['6 semaines',0,42],['7 semaines',0,49]],dental:[['1 an',12,0]]};
 function suggestedDue(performedOn,type,index){
  const option=dueOptions[type]?.[index];if(!option||!/^\d{4}-\d{2}-\d{2}$/.test(performedOn))return '';
  const date=new Date(performedOn+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==performedOn)return '';
  const originalDay=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+option[1]);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(originalDay,lastDay)+option[2]);return date.toISOString().slice(0,10);
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const displayDate=value=>value?new Date(value+'T12:00:00').toLocaleDateString('fr-FR'):'Non prévue';
 const day=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
 function modal(title){const d=document.createElement('dialog');d.className='horse-health-dialog';d.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" data-close>Fermer</button></header><p role="status" aria-live="polite"></p><div data-content></div>`;d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
 window.HorseHealth={
  suggestedDue,
  attach({host,horse,admin=false,api}){
   const prefix=`/api/${admin?'admin':'me'}/horses/${horse.id}`,state={due:horse.healthDue||[]};
   function render(){host.innerHTML=`<h3>Suivi sanitaire</h3>${state.due.length?state.due.map(item=>`<p><strong>${esc(item.label)}</strong> · ${displayDate(item.nextDueOn)}</p>`).join(''):'<p>Aucune échéance renseignée.</p>'}<button type="button" data-history>Gérer les interventions</button>`;host.querySelector('[data-history]').onclick=history;}
   async function refresh(){const result=await api(prefix);state.due=result.horse.healthDue||[];if(host.isConnected)render();}
   async function history(){const dialog=modal('Suivi sanitaire · '+horse.name),content=dialog.querySelector('[data-content]'),status=dialog.querySelector('[role=status]');let records=[],cursor=null;
    async function load(more=false){status.textContent='Chargement…';try{const result=await api(prefix+'/health'+(more?'?cursor='+cursor:''));records=more?[...records,...result.records]:result.records;cursor=result.nextCursor;
      content.innerHTML=`<button type="button" data-add>Ajouter une intervention</button><div>${records.map(r=>`<article><h3>${esc(r.label)}</h3><p>${esc(types[r.type])} · Réalisé le ${displayDate(r.performedOn)}</p><p>Prochaine échéance : ${displayDate(r.nextDueOn)}${!r.isCurrent?' · Historique':''}</p>${r.comment?`<p>${esc(r.comment)}</p>`:''}${admin&&r.notificationStatus?`<p>Rappels : ${esc(r.notificationStatus)}</p>`:''}${`<div class="health-actions"><button type="button" data-next="${r.id}">Nouvelle intervention</button><button type="button" data-edit="${r.id}">Corriger</button><button type="button" data-delete="${r.id}">Supprimer</button></div>`}</article>`).join('')||'<p>Aucune intervention enregistrée.</p>'}</div>${cursor?'<button type="button" data-more>Afficher la suite</button>':''}`;
      status.textContent='';content.querySelector('[data-add]')?.addEventListener('click',()=>edit());content.querySelector('[data-more]')?.addEventListener('click',()=>load(true));
      content.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(records.find(r=>r.id===Number(b.dataset.edit))));
      content.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>edit(null,records.find(r=>r.id===Number(b.dataset.next))));
      content.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Supprimer cette intervention et annuler ses rappels à venir ?'))return;const record=records.find(r=>r.id===Number(b.dataset.delete));b.disabled=true;try{await api(prefix+'/health/'+record.id,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({version:record.version})});await load();await refresh();}catch(error){status.textContent=error.message;b.disabled=false;}});
     }catch(error){status.textContent=error.message;}}
    function edit(record=null,previous=null){const d=modal(record?'Corriger l’intervention':'Nouvelle intervention'),box=d.querySelector('[data-content]'),message=d.querySelector('[role=status]');const selected=record||previous;
     box.innerHTML=`<form><label>Type<select name="type">${Object.entries(types).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label>Libellé du suivi<input name="label" maxlength="100" required></label><small>Réutilisez le même libellé pour le prochain rappel de ce soin (ex. vaccin grippe).</small><label>Date réalisée<input name="performedOn" type="date" max="${day()}" required></label><label>Prochaine échéance (facultative)<input name="nextDueOn" type="date"></label><div class="health-due-options" data-due-options></div><label>Commentaire (partagé avec l’écurie et les propriétaires)<textarea name="comment" maxlength="1500" rows="3"></textarea></label><button type="submit">Enregistrer</button></form>`;
     const form=box.querySelector('form');form.elements.type.value=selected?.type||'vaccine';form.elements.label.value=selected?.label||types.vaccine;form.elements.type.disabled=Boolean(record);form.elements.label.readOnly=Boolean(record);
     form.elements.performedOn.value=record?.performedOn||day();form.elements.nextDueOn.value=record?.nextDueOn||'';form.elements.comment.value=record?.comment||'';
     const shortcuts=form.querySelector('[data-due-options]');let selectedOffset=null;
     function showShortcuts(){const options=dueOptions[form.elements.type.value]||[];shortcuts.innerHTML=options.length?`<small>Calculer depuis la date réalisée :</small><div class="health-actions">${options.map((option,index)=>`<button type="button" data-offset="${index}" aria-pressed="${selectedOffset===index}">${option[0]}</button>`).join('')}</div><small>Vous pouvez aussi saisir ou ajuster la date manuellement.</small>`:'<small>Échéance à renseigner manuellement, si nécessaire.</small>';shortcuts.querySelectorAll('[data-offset]').forEach(button=>button.onclick=()=>{const index=Number(button.dataset.offset),value=suggestedDue(form.elements.performedOn.value,form.elements.type.value,index);if(!value){form.elements.performedOn.reportValidity();return;}selectedOffset=index;form.elements.nextDueOn.value=value;showShortcuts();});}
     form.elements.nextDueOn.oninput=()=>{selectedOffset=null;showShortcuts();};
     form.elements.performedOn.onchange=()=>{if(selectedOffset!==null)form.elements.nextDueOn.value=suggestedDue(form.elements.performedOn.value,form.elements.type.value,selectedOffset);};
     form.elements.type.onchange=()=>{if(Object.values(types).includes(form.elements.label.value))form.elements.label.value=types[form.elements.type.value];if(selectedOffset!==null)form.elements.nextDueOn.value='';selectedOffset=null;showShortcuts();};
     showShortcuts();
     form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='Enregistrement…';try{await api(prefix+'/health'+(record?'/'+record.id:''),{method:record?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:form.elements.type.value,label:form.elements.label.value,performedOn:form.elements.performedOn.value,nextDueOn:form.elements.nextDueOn.value||null,comment:form.elements.comment.value,...(record?{version:record.version}:{})})});d.close();await load();await refresh();}catch(error){message.textContent=error.message;button.disabled=false;}};
    }
    await load();
   }
   render();
  }
 };
})();
