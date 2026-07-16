import test from "node:test";
import assert from "node:assert/strict";
import {
  compatibleAlert,validateAlert,parisNow,isPushEnabled,sendRequestedPush,plainTextMessage,
  calculateStatus,publicSpace,publicSchedule,validateSpace,validateSchedules,timeToMinutes,
  normalizeEmail,validatePassword,validateNewUser,hashPassword,verifyPassword,validatePaddockBooking
} from "../src/worker.js";

test("les comptes utilisateurs normalisent et valident l’identité",()=>{
  assert.equal(normalizeEmail("  Test@Example.COM "),"test@example.com");
  assert.equal(validatePassword("trop-court"),"Le mot de passe doit contenir au moins 12 caractères");
  assert.equal(validateNewUser({email:"invalide",firstName:"A",lastName:"B"}).error,"Adresse email invalide");
  assert.deepEqual(validateNewUser({
    email:" Test@Example.COM ",firstName:" Alice ",lastName:" Martin ",role:"client"
  }),{email:"test@example.com",firstName:"Alice",lastName:"Martin",cardNumber:"",role:"client"});
});

test("les créneaux paddock sont validés côté Worker",()=>{
  assert.deepEqual(validatePaddockBooking({paddock:"grande",date:"2026-07-17",time:"09:30",duration:90}),{
    paddock:"grande",date:"2026-07-17",time:"09:30",duration:90,startMinutes:570
  });
  assert.equal(validatePaddockBooking({paddock:"inconnu",date:"2026-07-17",time:"09:30",duration:90}).error,"Paddock invalide");
  assert.equal(validatePaddockBooking({paddock:"grande",date:"2026-07-17",time:"09:30",duration:45}).error,"Durée invalide");
});

test("les mots de passe sont salés et vérifiables",async()=>{
  const encoded=await hashPassword("mot-de-passe-beta-solide");
  const user={password_hash:encoded.hash,password_salt:encoded.salt,password_iterations:encoded.iterations};
  assert.equal(await verifyPassword("mot-de-passe-beta-solide",user),true);
  assert.equal(await verifyPassword("autre-mot-de-passe",user),false);
  const second=await hashPassword("mot-de-passe-beta-solide");
  assert.notEqual(second.salt,encoded.salt);
});

test("le contrat public conserve les neuf champs historiques",()=>{
  const value=compatibleAlert({
    id:167,date:"2026-07-14",heure:"12:30",categorie:"Test",
    titre:"Alerte",message:"Message",epingle:"oui",active:"oui"
  });

  assert.deepEqual(Object.keys(value),[
    "id","date","heure","categorie","titre","message","epingle","expire","active"
  ]);
  assert.equal(value.expire,"");
  assert.equal(value.id,167);
});

test("les valeurs de publication sont normalisées",()=>{
  const value=validateAlert({
    titre:"  Titre  ",message:"  Message  ",categorie:" Information ",
    epingle:true,active:false,pushRequested:true
  });

  assert.equal(value.titre,"Titre");
  assert.equal(value.message,"Message");
  assert.equal(value.categorie,"Information");
  assert.equal(value.epingle,"oui");
  assert.equal(value.active,"non");
  assert.equal(value.pushRequested,1);
});

test("le titre et le message sont obligatoires",()=>{
  assert.equal(validateAlert({message:"Message"}).error,"Le titre est obligatoire");
  assert.equal(validateAlert({titre:"Titre"}).error,"Le message est obligatoire");
});

test("les balises HTML sont refusées avant affichage dans l’ancien client",()=>{
  assert.equal(
    validateAlert({titre:"<img src=x>",message:"Message"}).error,
    "Les balises HTML ne sont pas autorisées"
  );
});

test("la date serveur est produite au format historique",()=>{
  const now=parisNow();
  assert.match(now.date,/^\d{4}-\d{2}-\d{2}$/);
  assert.match(now.time,/^\d{2}:\d{2}$/);
  assert.match(now.iso,/^\d{4}-\d{2}-\d{2}T/);
});

test("le push exige le drapeau, l’App ID et la clé REST",()=>{
  assert.equal(isPushEnabled({PUSH_ENABLED:"true",ONESIGNAL_APP_ID:"app"}),false);
  assert.equal(isPushEnabled({
    PUSH_ENABLED:"true",ONESIGNAL_APP_ID:"app",ONESIGNAL_REST_API_KEY:"secret"
  }),true);
});

test("un push déjà envoyé ne peut pas être envoyé deux fois",async()=>{
  const result=await sendRequestedPush({
    PUSH_ENABLED:"true",ONESIGNAL_APP_ID:"app",ONESIGNAL_REST_API_KEY:"secret"
  },{
    id:168,titre:"Test",message:"Message",active:"oui",
    push_requested:1,push_sent_at:"2026-07-14T13:00:00.000Z"
  });
  assert.equal(result.status,"already-sent");
});

test("OneSignal reçoit un message sans marqueurs de mise en forme",()=>{
  assert.equal(
    plainTextMessage("**Important**\n__Souligné__\n[Consulter](https://example.com/page)"),
    "Important\nSouligné\nConsulter"
  );
});

test("le mode ouvert suit les horaires propres à l’espace",()=>{
  const schedule={opens_at:"10:00",closes_at:"20:00"};
  assert.equal(calculateStatus("ouvert",schedule,9*60),"prevision");
  assert.equal(calculateStatus("ouvert",schedule,10*60),"ouvert");
  assert.equal(calculateStatus("ouvert",schedule,19*60+59),"ouvert");
  assert.equal(calculateStatus("ouvert",schedule,20*60),"prevision");
});

test("les statuts manuels neutralisent le calcul automatique",()=>{
  const schedule={opens_at:"08:00",closes_at:"21:00"};
  assert.equal(calculateStatus("prevision",schedule,12*60),"prevision");
  assert.equal(calculateStatus("ferme",schedule,12*60),"ferme");
  assert.equal(calculateStatus("hors-service",schedule,12*60),"hors-service");
});

test("fermé et hors service masquent les horaires",()=>{
  const base={slug:"manege",manual_status:"ferme",liberte:"non",longe:"oui",info:"",special_hours:"Prévu 19h"};
  const schedule={opens_at:"10:00",closes_at:"20:00"};
  const closed=publicSpace(base,schedule,12*60);
  assert.equal(closed.horaire_affiche,"");
  assert.equal(closed.horaire_special,"");
  const forecast=publicSpace({...base,manual_status:"prevision"},schedule,12*60);
  assert.equal(forecast.horaire_affiche,"10:00 - 20:00");
  assert.equal(forecast.horaire_special,"Prévu 19h");
});

test("les horaires de nuit sont acceptés",()=>{
  const schedule={opens_at:"20:00",closes_at:"02:00"};
  assert.equal(calculateStatus("ouvert",schedule,23*60),"ouvert");
  assert.equal(calculateStatus("ouvert",schedule,60),"ouvert");
  assert.equal(calculateStatus("ouvert",schedule,12*60),"prevision");
});

test("les sept jours sont validés",()=>{
  const schedules=Array.from({length:7},(_,index)=>({day:index+1,opensAt:"08:00",closesAt:"21:00"}));
  assert.equal(validateSchedules(schedules).rows.length,7);
  assert.equal(validateSchedules(schedules.slice(0,6)).error,"Les sept jours sont obligatoires");
  assert.equal(timeToMinutes("24:00"),null);
  assert.deepEqual(publicSchedule({day:1,opens_at:"08:00",closes_at:"21:00"}),{
    jour:"lundi",ouvert:"08:00",ferme:"21:00"
  });
});

test("les champs d’un espace sont normalisés",()=>{
  const value=validateSpace({manualStatus:" OUVERT ",liberte:"oui",longe:"non",info:" Test ",specialHours:" Prévu 19h "});
  assert.equal(value.manualStatus,"ouvert");
  assert.equal(value.liberte,"oui");
  assert.equal(value.longe,"non");
  assert.equal(value.info,"Test");
  assert.equal(value.specialHours,"Prévu 19h");
});
