(function initializeProfileStore(){
const DB_NAME="ecurie-user-profile";
const DB_VERSION=1;
const STORE_NAME="profiles";
const PROFILE_ID="current";
const CARD_KEY="paddockCardNumber";

function openDatabase(){
return new Promise((resolve,reject)=>{
const request=indexedDB.open(DB_NAME,DB_VERSION);
request.onupgradeneeded=()=>{
const db=request.result;
if(!db.objectStoreNames.contains(STORE_NAME)){
db.createObjectStore(STORE_NAME,{keyPath:"id"});
}
};
request.onsuccess=()=>resolve(request.result);
request.onerror=()=>reject(request.error);
});
}

async function readRecord(){
const db=await openDatabase();
return new Promise((resolve,reject)=>{
const transaction=db.transaction(STORE_NAME,"readonly");
const request=transaction.objectStore(STORE_NAME).get(PROFILE_ID);
request.onsuccess=()=>resolve(request.result||null);
request.onerror=()=>reject(request.error);
transaction.oncomplete=()=>db.close();
});
}

async function writeRecord(record){
const db=await openDatabase();
return new Promise((resolve,reject)=>{
const transaction=db.transaction(STORE_NAME,"readwrite");
transaction.objectStore(STORE_NAME).put(record);
transaction.oncomplete=()=>{db.close();resolve();};
transaction.onerror=()=>{db.close();reject(transaction.error);};
transaction.onabort=()=>{db.close();reject(transaction.error);};
});
}

async function deleteRecord(){
const db=await openDatabase();
return new Promise((resolve,reject)=>{
const transaction=db.transaction(STORE_NAME,"readwrite");
transaction.objectStore(STORE_NAME).delete(PROFILE_ID);
transaction.oncomplete=()=>{db.close();resolve();};
transaction.onerror=()=>{db.close();reject(transaction.error);};
transaction.onabort=()=>{db.close();reject(transaction.error);};
});
}

function normalizeCardNumber(value){
return String(value||"").trim().replace(/^'+/,"").toUpperCase();
}

function readCardNumber(){
try{
return normalizeCardNumber(localStorage.getItem(CARD_KEY));
}catch(e){
return "";
}
}

async function get(){
let record=null;
try{
record=await readRecord();
}catch(e){}

return{
firstName:String(record?.firstName||""),
email:String(record?.email||""),
photo:record?.photo instanceof Blob?record.photo:null,
cardNumber:readCardNumber()
};
}

async function save(profile){
const record={
id:PROFILE_ID,
firstName:String(profile.firstName||"").trim(),
email:String(profile.email||"").trim(),
photo:profile.photo instanceof Blob?profile.photo:null
};

await writeRecord(record);

const cardNumber=normalizeCardNumber(profile.cardNumber);
try{
if(cardNumber){
localStorage.setItem(CARD_KEY,cardNumber);
}else{
localStorage.removeItem(CARD_KEY);
}
}catch(e){}

return get();
}

async function reset(){
try{
await deleteRecord();
}catch(e){}
try{
localStorage.removeItem(CARD_KEY);
}catch(e){}
}

window.ProfileStore=Object.freeze({get,save,reset});
})();
