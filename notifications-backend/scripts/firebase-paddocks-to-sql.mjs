const PROJECT="ecurie-paddock";
const API_KEY="AIzaSyBn6Hgu-xvsWqpwJ-i4lZyI0QjKMBvOeXA";
const BASE=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const RESERVATION_CUTOFF="2026-07-16";

function value(field){
  if(!field)return null;
  if("stringValue" in field)return field.stringValue;
  if("integerValue" in field)return Number(field.integerValue);
  if("doubleValue" in field)return Number(field.doubleValue);
  if("booleanValue" in field)return Boolean(field.booleanValue);
  if("nullValue" in field)return null;
  if("mapValue" in field)return Object.fromEntries(Object.entries(field.mapValue.fields||{}).map(([key,item])=>[key,value(item)]));
  if("arrayValue" in field)return(field.arrayValue.values||[]).map(value);
  return null;
}

function decode(document){
  return Object.fromEntries(Object.entries(document.fields||{}).map(([key,item])=>[key,value(item)]));
}

function quote(input){
  if(input===null||input===undefined)return"NULL";
  return`'${String(input).replaceAll("'","''")}'`;
}

async function collection(name){
  const response=await fetch(`${BASE}/${name}?pageSize=1000&key=${API_KEY}`);
  if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);
  return(await response.json()).documents||[];
}

const [reservations,hours,restrictions]=await Promise.all([
  collection("reservations"),collection("horaires"),collection("restrictions")
]);
const now=new Date().toISOString();
const statements=[];

for(const document of reservations.filter(document=>String(decode(document).date||"")>=RESERVATION_CUTOFF)){
  const row=decode(document);
  const legacyId=document.name.split("/").pop();
  const lockKey="firebase-"+legacyId;
  const email=String(row.email||"").trim().toLowerCase();
  const duration=Number(row.duration)||60;
  statements.push(`INSERT OR IGNORE INTO paddock_reservations(lock_key,legacy_firebase_id,user_id,name,email,paddock,date,time,duration,created_at) VALUES(${quote(lockKey)},${quote(legacyId)},${email?`(SELECT id FROM users WHERE email=${quote(email)} COLLATE NOCASE LIMIT 1)`:"NULL"},${quote(row.name||"")},${quote(email)},${quote(row.paddock)},${quote(row.date)},${quote(row.time)},${duration},${quote(document.createTime||now)});`);
  const [hoursValue,minutesValue]=String(row.time||"00:00").split(":").map(Number);
  const start=hoursValue*60+minutesValue;
  for(let slot=start;slot<start+duration;slot+=30){
    statements.push(`INSERT OR IGNORE INTO paddock_slot_locks(date,paddock,slot_minute,reservation_key) VALUES(${quote(row.date)},${quote(row.paddock)},${slot},${quote(lockKey)});`);
  }
}

for(const document of hours){
  const paddock=document.name.split("/").pop();
  statements.push(`INSERT INTO paddock_hours(paddock,schedule_json,updated_at) VALUES(${quote(paddock)},${quote(JSON.stringify(decode(document)))},${quote(document.updateTime||now)}) ON CONFLICT(paddock) DO UPDATE SET schedule_json=excluded.schedule_json,updated_at=excluded.updated_at;`);
}

for(const document of restrictions){
  const date=document.name.split("/").pop();
  const row=decode(document);
  statements.push(`INSERT INTO paddock_restrictions(date,block_grande_90,block_beudot_90,updated_at) VALUES(${quote(date)},${row.blockGrande90?1:0},${row.blockBeudot90?1:0},${quote(document.updateTime||now)}) ON CONFLICT(date) DO UPDATE SET block_grande_90=excluded.block_grande_90,block_beudot_90=excluded.block_beudot_90,updated_at=excluded.updated_at;`);
}

process.stdout.write(statements.join("\n")+"\n");
