/* Notes API — sends what the spectator types to your Cloudflare Worker,
   so other apps can GET it with your URL (https://WORKER/api?key=KEY).
   Settings markup: ids naApiPw, naUrl, naCopy, naReset, naClear, naSt, naOn, naWorker.
   Use: NotesAPI.push(text) on each input. NotesAPI.mount() after the settings exist. */
(function(){
// <script src="../notes-api.js" data-ch="calc" data-title="Calculator"> = separate saved text + notification title
const ME=document.currentScript;
const CH=((ME&&ME.dataset.ch)||'').toLowerCase().replace(/[^a-z0-9_-]/g,'');
const TITLE=(ME&&ME.dataset.title)||'Notes';
const Q=p=>p+(CH?(p.includes('?')?'&':'?')+'ch='+CH:'');
// After the Worker is deployed, put its address here (spectator phones use this one).
const DEFAULT_WORKER = "https://notes-api.frankiemagic99.workers.dev";

const ls={get:(k,d)=>{try{const v=localStorage.getItem(k);return v===null?d:v}catch(e){return d}},
          set:(k,v)=>{try{v===''||v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
const base=()=>(ls.get('naWorker','')||DEFAULT_WORKER).replace(/\/+$/,'');
const on=()=>ls.get('naOn'+CH,'1')!=='0';

let tm=null,tm2=null,last=null,told=null;
function send(text,done){
  fetch(base()+Q('/push'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,done:!!done,title:TITLE}),keepalive:true}).catch(()=>{});
}
function push(text,opts){
  if(!on()||!base())return;
  if(opts&&opts.skip)return;
  text=String(text||'');
  clearTimeout(tm);clearTimeout(tm2);
  tm=setTimeout(()=>{if(text===last)return;last=text;send(text,false)},1500);   // save 1.5 s after typing stops
  tm2=setTimeout(()=>{if(!text.trim()||text===told)return;told=text;last=text;send(text,true)},4000);   // done: 4 s with no typing -> notification
}
async function inbox(){try{return await (await fetch(base()+Q('/inbox'),{cache:'no-store'})).json()}catch(e){return{text:'',at:0}}}

async function admin(path,method){
  const r=await fetch(base()+Q(path),{method:method||'GET',headers:{'X-Admin-Password':ls.get('naPw','')},cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
  return d;
}

function mount(){
  const $=id=>document.getElementById(id);
  if(!$('naUrl'))return;
  const st=t=>{$('naSt').textContent=t};
  let url='';
  $('naOn').checked=on();
  $('naOn').onchange=e=>ls.set('naOn'+CH,e.target.checked?'1':'0');
  $('naWorker').value=ls.get('naWorker','');
  $('naWorker').placeholder=DEFAULT_WORKER||'https://notes-api….workers.dev';
  $('naWorker').onchange=e=>{ls.set('naWorker',e.target.value.trim());load()};
  $('naApiPw').value=ls.get('naPw','');
  $('naApiPw').onchange=e=>{ls.set('naPw',e.target.value.trim());load()};
  async function load(){
    if(!base()){$('naUrl').textContent='—';return st('Set the Worker address')}
    if(!ls.get('naPw','')){$('naUrl').textContent='—';return st('Type the admin password')}
    try{const d=await admin('/admin');url=d.url;$('naUrl').textContent=url;st('Ready')}
    catch(e){st(e.message)}
  }
  $('naCopy').onclick=async()=>{if(!url)return st('No URL yet');try{await navigator.clipboard.writeText(url);st('URL copied')}catch(e){st('Hold the URL to copy it')}};
  // One tap, no confirm (like Kill). The old URL stops at once.
  $('naReset').onclick=async()=>{try{const d=await admin('/admin/reset','POST');url=d.url;$('naUrl').textContent=url;st('New key. Paste the new URL in the other app.')}catch(e){st(e.message)}};
  $('naClear').onclick=async()=>{try{await admin('/admin/clear','POST');last=null;told=null;st('Saved note cleared')}catch(e){st(e.message)}};
  load();
}
window.NotesAPI={push,inbox,mount};
})();
