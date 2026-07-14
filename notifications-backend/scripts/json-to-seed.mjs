import fs from "node:fs";

const inputPath=process.argv[2];
if(!inputPath){
  console.error("Usage: node scripts/json-to-seed.mjs export.json");
  process.exit(1);
}

const rows=JSON.parse(fs.readFileSync(inputPath,"utf8"));
if(!Array.isArray(rows))throw new Error("L’export doit être un tableau JSON");

const quote=value=>"'"+String(value??"").replaceAll("'","''")+"'";
const now=new Date().toISOString();

for(const row of rows){
  if(!Number.isInteger(Number(row.id)))throw new Error("ID invalide dans l’export");
  console.log(`INSERT OR REPLACE INTO alerts(
  id,date,heure,categorie,titre,message,epingle,active,
  push_requested,push_sent_at,onesignal_notification_id,created_at,updated_at
) VALUES(
  ${Number(row.id)},${quote(row.date)},${quote(row.heure)},${quote(row.categorie)},
  ${quote(row.titre)},${quote(row.message)},${quote(row.epingle||"")},
  ${quote(row.active||"non")},0,NULL,NULL,${quote(now)},${quote(now)}
);`);
}
