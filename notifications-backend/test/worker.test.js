import test from "node:test";
import assert from "node:assert/strict";
import {compatibleAlert,validateAlert,parisNow} from "../src/worker.js";

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
