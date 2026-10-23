(function(){
  const paddocks=[{id:'maison',label:'Maison'},{id:'grande',label:'Grande Voie'},{id:'beudot',label:'Beudot'}];
  const mins=value=>{const [h,m]=String(value||'').split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null};
  const clockValue=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
  const dayName=date=>new Date(date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long'}).toLowerCase();
  function reservations(date,paddock){return (state.paddockReservations||[]).filter(item=>item.date===date&&item.paddock===paddock);}
  function slots(date){const set=new Set(),name=dayName(date);for(const paddock of paddocks){const cfg=state.paddockHours?.[paddock.id]?.[name];if(cfg&&!cfg.closed){for(let t=mins(cfg.open);t<mins(cfg.close);t+=60)set.add(clockValue(t));}for(const item of reservations(date,paddock.id)){const start=mins(item.time),end=start+Number(item.duration||60);set.add(item.time);if(Number.isFinite(end))set.add(clockValue(end));}}return [...set].sort((a,b)=>mins(a)-mins(b));}
  function covered(date,paddock,time){const at=mins(time);return reservations(date,paddock).some(item=>{const start=mins(item.time);return at>start&&at<start+Number(item.duration||60)});}
  const originalTaskHtml=taskHtml;
  taskHtml=function(task){const taskDate=add(week,task.dayIndex),late=!task.completedAt&&taskDate<iso(new Date());return originalTaskHtml(task).replace('class="task ',`class="task ${late?'overdue ':''}`);};
  function updateTaskScrollCue(){
    const scroller=board.querySelector('.daily-tasks-scroll'),cue=board.querySelector('.task-scroll-cue');
    if(!scroller||!cue)return;
    const hasMore=scroller.scrollHeight>scroller.clientHeight+2&&scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-8;
    cue.classList.toggle('visible',hasMore);
  }
  function bindTaskScrollCue(){
    const scroller=board.querySelector('.daily-tasks-scroll');
    if(!scroller)return;
    scroller.addEventListener('scroll',updateTaskScrollCue,{passive:true});
    requestAnimationFrame(updateTaskScrollCue);
  }
  function paddockBoard(date){
    const allSlots=slots(date),name=dayName(date),requestCount=(state.paddockRequests||[]).filter(item=>item.date===date).length;
    const reminder=requestCount?`<div class="request-reminder"><span class="request-count">${requestCount}</span><span>Demande${requestCount>1?'s':''} de mise au paddock aujourd’hui</span></div>`:'';
    const columns=paddocks.map(p=>{
      const cfg=state.paddockHours?.[p.id]?.[name],hours=cfg?.closed?'Fermé':`${cfg?.open||'--:--'} – ${cfg?.close||'--:--'}`;
      const rows=allSlots.map(time=>{
        if(covered(date,p.id,time))return'';
        const item=reservations(date,p.id).find(x=>mins(x.time)===mins(time));
        if(item){const blocked=String(item.name).toLowerCase().startsWith('blocage');return `<div class="slot ${blocked?'blocked':'booked'}"><div class="slot-time">${esc(time)}</div><div><div class="slot-name">${esc(item.name)}</div><div class="slot-meta">${Number(item.duration)} min · jusqu’à ${clockValue(mins(item.time)+Number(item.duration))}</div></div></div>`}
        const open=cfg&&!cfg.closed&&mins(time)>=mins(cfg.open)&&mins(time)<mins(cfg.close);
        return `<div class="slot free"><div class="slot-time">${esc(time)}</div><div class="slot-name">${open?'Libre':'Fermé'}</div></div>`;
      }).join('');
      return `<article class="paddock-column"><div class="paddock-top"><div class="paddock-title"><span class="paddock-icon" aria-hidden="true">♞</span>${p.label}</div><div class="paddock-hours">${hours}</div></div><div class="slot-list">${rows||'<div class="no-task">Aucun créneau visible</div>'}</div></article>`;
    }).join('');
    return `<section class="paddock-wrap"><div class="panel-heading"><h2 class="paddock-board-title"><span class="panel-icon" aria-hidden="true">♞</span>Planning paddocks</h2><div class="panel-meta">${paddocks.length} paddocks · Aujourd’hui</div></div>${reminder}<div class="paddock-board">${columns}</div></section>`;
  }
  render=function(){dayMode.classList.toggle('active',mode==='day');weekMode.classList.toggle('active',mode==='week');board.classList.toggle('day-board',mode==='day');if(mode==='day'){const date=new Date(selected+'T12:00:00');period.textContent=date.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});const di=dayIndex(),activeHorses=state.horses.map(h=>({horse:h,tasks:state.tasks.filter(t=>t.horseId===h.id&&t.dayIndex===di)})).filter(item=>item.tasks.length),horseCount=`${activeHorses.length} cheval${activeHorses.length>1?'x':''}`,horses=`<section class="daily-tasks-panel"><div class="panel-heading"><h2 class="daily-tasks-title"><span class="panel-icon" aria-hidden="true">✓</span>Tâches des chevaux</h2><div class="panel-meta">${horseCount} · Planning du jour</div></div><div class="daily-tasks-scroll"><div class="daily">${activeHorses.map(item=>`<article class="horse-card"><div class="horse-card-title"><span class="horse-avatar" aria-hidden="true">🐴</span><h2>${esc(item.horse.name)}</h2><span class="horse-card-menu" aria-hidden="true">•••</span></div>${item.tasks.map(taskHtml).join('')}</article>`).join('')||'<p class="empty">Aucune tâche prévue ce jour.</p>'}</div></div><div class="task-scroll-cue" aria-hidden="true"></div></section>`;board.innerHTML=`<div class="daily-layout">${horses}${paddockBoard(selected)}</div>`;bindTaskScrollCue()}else{period.textContent='Semaine du '+new Date(week+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});let html='<div class="week-grid"><div></div>'+days.map(d=>`<div class="head">${d}</div>`).join('');for(const h of state.horses){html+=`<div class="horse">${esc(h.name)}</div>`;for(let d=0;d<7;d++)html+=`<div class="cell">${state.tasks.filter(t=>t.horseId===h.id&&t.dayIndex===d).map(taskHtml).join('')}</div>`}board.innerHTML=html+'</div>'}board.querySelectorAll('.task:not(.done)').forEach(el=>el.onclick=()=>complete(Number(el.dataset.id)))};
  window.addEventListener('resize',updateTaskScrollCue,{passive:true});
  if(state?.horses)render();
})();
