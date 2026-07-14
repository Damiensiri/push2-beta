import test from "node:test";
import assert from "node:assert/strict";
import {
  compatibleAlert,validateAlert,parisNow,isPushEnabled,sendRequestedPush
} from "../src/worker.js";

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
