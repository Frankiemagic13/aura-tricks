/* Notes API — sends what the spectator types to your Cloudflare Worker,
   so other apps can GET it with your URL (https://WORKER/api?key=KEY).
   Settings markup: ids naApiPw, naUrl, naCopy, naReset, naClear, naSt, naOn, naWorker.
   Use: NotesAPI.push(text) on each input. NotesAPI.mount() after the settings exist. */
(function(){
// <script src="../notes-api.js" data-ch="calc" data-title="Calculator"> = separate saved text + notification title
const ME=document.currentScript;
const CH=((ME&&ME.dataset.ch)||'').toLowerCase().replace(/[^a-z0-9_-]/g,'');
const TITLE=(ME&&ME.dataset.title)||'Notes';
const chOf=me=>me?(CH?CH+'-':'')+'me':CH;   // the Magician phone uses its own slot (ch=me / calc-me), so predictions never replace the spectator's text
const Q=(p,me)=>{const c=chOf(me);return p+(c?(p.includes('?')?'&':'?')+'ch='+c:'')};
// After the Worker is deployed, put its address here (spectator phones use this one).
const DEFAULT_WORKER = "https://notes-api.frankiemagic99.workers.dev";

const ls={get:(k,d)=>{try{const v=localStorage.getItem(k);return v===null?d:v}catch(e){return d}},
          set:(k,v)=>{try{v===''||v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
const base=()=>(ls.get('naWorker','')||DEFAULT_WORKER).replace(/\/+$/,'');
const on=()=>ls.get('naOn'+CH,'1')!=='0';
const meOn=()=>ls.get('naMe'+CH,'0')==='1';
// Wait before the notification: setting on this phone, else ?nw=SECONDS in the link, else 2 s (spectator phones)
const DEFAULT_WAIT=2;
const waitMs=()=>{const u=Number(new URLSearchParams(location.search).get('nw'));const v=Number(ls.get('naWait'+CH,''))||u||DEFAULT_WAIT;return Math.min(Math.max(v,0.5),10)*1000};

let tm=null,tm2=null,last=null,told=null;
function send(text,done,me){
  fetch(base()+Q('/push',me),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,done:!!done,title:me?TITLE+' (Magician)':TITLE}),keepalive:true}).catch(()=>{});
}
// opts.mirror = this is the Magician phone (mirror). It sends only when "Also send from my phone" is on.
function push(text,opts){
  if(!on()||!base())return;
  const me=!!(opts&&(opts.mirror||opts.skip));
  if(me&&!meOn())return;
  text=String(text||'');
  clearTimeout(tm);clearTimeout(tm2);
  const done=()=>{if(!text.trim()||text===told)return;told=text;last=text;send(text,true,me)};
  // At once: Return at the end of a note, or the Calculator = (opts.now)
  if(text.trim()&&((opts&&opts.now)||/\n\s*$/.test(text))){done();return}
  tm=setTimeout(()=>{if(text===last)return;last=text;send(text,false,me)},Math.min(1500,waitMs()));   // save after typing stops
  tm2=setTimeout(done,waitMs());   // done: no typing for the wait time -> notification
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
  if($('naMe')){$('naMe').checked=meOn();$('naMe').onchange=e=>ls.set('naMe'+CH,e.target.checked?'1':'0')}
  if($('naWait')){$('naWait').value=String(ls.get('naWait'+CH,'')||'');$('naWait').onchange=e=>ls.set('naWait'+CH,e.target.value)}
  $('naWorker').value=ls.get('naWorker','');
  $('naWorker').placeholder=DEFAULT_WORKER||'https://notes-api….workers.dev';
  $('naWorker').onchange=e=>{ls.set('naWorker',e.target.value.trim());load()};
  if($('naMuteCos')){$('naMuteCos').checked=muteOn();$('naMuteCos').onchange=e=>{ls.set('naMuteCos',e.target.checked?'1':'0');if(NotesAPI._muteUpd)NotesAPI._muteUpd()}}
  $('naApiPw').value=ls.get('naPw','');
  $('naApiPw').onchange=e=>{ls.set('naPw',e.target.value.trim());load()};
  function meUrl(k){const e=$('naUrlMe');if(e)e.textContent='Magician: '+base()+'/api?ch='+chOf(true)+'&key='+k}
  async function load(){
    if(!base()){$('naUrl').textContent='—';return st('Set the Worker address')}
    if(!ls.get('naPw','')){$('naUrl').textContent='—';return st('Type the admin password')}
    try{const d=await admin('/admin');url=d.url;$('naUrl').textContent=url;meUrl(d.key);st('Ready')}
    catch(e){st(e.message)}
  }
  $('naCopy').onclick=async()=>{if(!url)return st('No URL yet');try{await navigator.clipboard.writeText(url);st('URL copied')}catch(e){st('Hold the URL to copy it')}};
  // One tap, no confirm (like Kill). The old URL stops at once.
  $('naReset').onclick=async()=>{try{const d=await admin('/admin/reset','POST');url=d.url;$('naUrl').textContent=url;meUrl(d.key);st('New key. Paste the new URL in the other app.')}catch(e){st(e.message)}};
  $('naClear').onclick=async()=>{try{await admin('/admin/clear','POST');last=null;told=null;st('Saved note cleared')}catch(e){st(e.message)}};
  load();
}
/* No notifications while the Cosmos is connected (this phone needs the admin password).
   Setting: localStorage "naMuteCos" ('1' = on, the default). The Worker ends the mute by itself after 5 min,
   so this phone sends it again every 4 min while the Cosmos stays connected. */
const muteOn=()=>ls.get('naMuteCos','1')!=='0';
let muted=false,muteT=null;
function mute(on){
  const pw=ls.get('naPw','');if(!pw||!base())return;
  fetch(base()+'/admin/mute',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':pw},body:JSON.stringify({on:!!on,ttl:300}),keepalive:true}).catch(()=>{});
}
function cosmosMute(C){
  if(!C||!C.on)return;
  const upd=()=>{const want=muteOn()&&C.connected;
    if(want&&!muted){muted=true;mute(true);clearInterval(muteT);muteT=setInterval(()=>mute(true),240000)}
    else if(!want&&muted){muted=false;clearInterval(muteT);muteT=null;mute(false)}};
  C.on('change',upd);NotesAPI._muteUpd=upd;upd();
}
window.NotesAPI={push,inbox,mount,mute,cosmosMute};
})();
