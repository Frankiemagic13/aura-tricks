/* Soft dark settings look ("H") with tabs, shared by all trick pages.
   Use: <div id="sheet" data-hui='{"tabs":[{"n":"PIN","i":"pin","s":["Equation","Passcode"]}, ...]}'>
   - Each .lbl starts a section. A section goes to the first tab whose "s" list has a word that starts the .lbl text.
     An element with data-tab="Name" goes to that tab directly. Sections that match no tab go to the last tab.
   - The .lbl and the .grp / .seg right after it become one card.
   - The Done button in .shead / .hd moves to the new header, so its handlers stay. */
(function(){
const ICONS={
pin:'<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
unlock:'<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
inject:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
peek:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
look:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2 0-1.5-1-2 0-3s4 1 5-2"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
calc:'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
light:'<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
routine:'<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
buttons:'<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/>',
sensor:'<path d="M5 12a7 7 0 0 1 14 0"/><path d="M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="16" r="1.5"/>',
phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
log:'<path d="M4 6h16M4 12h16M4 18h10"/>',
more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'};
const svg=n=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[n]||ICONS.more)+'</svg>';
const CSS=`
.hui{--hb:#1e2026;--hd:#121318;--hl:#2a2d35;--ht:#e9eaee;--hm:#7d818c;--ha:#ff9f0a;
  background:var(--hb)!important;color:var(--ht)!important;font-family:-apple-system,system-ui,"SF Pro Text","Helvetica Neue",sans-serif}
#sheet.hui{top:0!important;bottom:0!important;left:0!important;right:0!important;max-height:none!important;height:auto!important;max-width:none!important;margin:0!important;
  border-radius:0!important;padding:0 0 calc(env(safe-area-inset-bottom) + 30px)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;box-shadow:none!important}
.hui .grab,.hui>.shead,.hui>.hd,.hui>h1{display:none!important}
.hui .hui-top{position:sticky;top:0;z-index:3;background:var(--hb);padding:calc(env(safe-area-inset-top) + 14px) 18px 8px}
.hui .hui-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.hui .hui-title{font-size:28px;font-weight:700;letter-spacing:.2px;color:var(--ht);line-height:1.1}
.hui .hui-sub{font-size:14px;font-weight:600;color:var(--ha);margin-top:3px;letter-spacing:.2px}
.hui .hui-done{padding:8px 16px!important;width:auto!important;border-radius:18px!important;border:0!important;background:var(--hb)!important;color:var(--ha)!important;
  box-shadow:4px 4px 10px var(--hd),-4px -4px 10px var(--hl)!important;font:600 15px -apple-system,system-ui!important;text-align:center!important;height:auto!important}
.hui .hui-tabs{display:flex;gap:8px;padding:12px 0 8px}
.hui .hui-tabs button{flex:1;min-width:0;height:62px;border-radius:19px;border:0;background:var(--hb);box-shadow:5px 5px 12px var(--hd),-5px -5px 12px var(--hl);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:700 11px -apple-system,system-ui;color:var(--hm);padding:0 2px;
  transition:box-shadow .15s,color .15s}
.hui .hui-tabs button span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.hui .hui-tabs button.on{box-shadow:inset 4px 4px 9px var(--hd),inset -4px -4px 9px var(--hl);color:var(--ha)}
.hui .hui-tabs svg{width:21px;height:21px}
.hui .hui-pane{display:none;padding:2px 16px 10px}.hui .hui-pane.on{display:block}
.hui .hui-card{margin:16px 0 0;border-radius:22px;background:var(--hb);box-shadow:8px 8px 18px var(--hd),-8px -8px 18px var(--hl);padding:4px 0 6px;overflow:hidden}
.hui .lbl{font-size:12px!important;font-weight:700!important;color:var(--hm)!important;text-transform:uppercase!important;letter-spacing:.3px;margin:18px 4px 6px!important}
.hui .hui-card>.lbl{margin:10px 18px 2px!important}
.hui .grp{background:transparent!important;border-radius:0!important;box-shadow:none!important;margin:0!important}
.hui .r{min-height:48px;padding:0 18px!important;font-size:16px!important;color:var(--ht)}
.hui .r+.r::before{display:none!important}
.hui .note,.hui .snote{font-size:13px!important;color:var(--hm)!important;margin:10px 6px 0!important;line-height:1.4!important}
.hui .r select{color:#8d919c!important;font-size:16px!important;background:none!important;-webkit-appearance:none!important;appearance:none!important;direction:ltr!important;text-align:right!important;text-align-last:right;max-width:62%;border:0!important;outline:none}
.hui .r select option{color:#000}
.hui .r input[type=text],.hui .r input[type=number],.hui .r input:not([type]),.hui .r input.tx,.hui .r input[inputmode]{color:var(--ht)!important;font-size:16px!important;background:none!important}
.hui input[type=checkbox]{-webkit-appearance:none!important;appearance:none!important;width:51px!important;height:31px!important;min-width:51px;border-radius:16px!important;margin:0!important;
  background:#16171c!important;box-shadow:inset 2px 2px 5px #0c0d10,inset -2px -2px 5px #262931!important;position:relative!important;transform:none!important;cursor:pointer;flex:none;
  transition:background .2s,box-shadow .2s;outline:none;border:0!important}
.hui input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.35);transition:left .2s}
.hui input[type=checkbox]:checked{background:var(--ha)!important;box-shadow:0 0 12px rgba(255,159,10,.35)!important}
.hui input[type=checkbox]:checked::after{left:22px}
.hui input[type=checkbox]:disabled{opacity:.4}
.hui .sbtn,.hui .btn{color:var(--ha)!important;font-weight:600!important;font-size:16px!important;background:none!important;border:0!important}
.hui .seg{background:var(--hb)!important;border-radius:14px!important;padding:4px!important;margin:8px 14px!important;box-shadow:inset 3px 3px 7px var(--hd),inset -3px -3px 7px var(--hl)}
.hui>.hui-pane>.seg,.hui .hui-pane>.seg{margin:14px 0 4px!important}
.hui .seg button{color:var(--hm)!important;font-weight:600!important;border-radius:11px!important}
.hui .seg button.on{background:var(--hb)!important;color:var(--ha)!important;box-shadow:3px 3px 7px var(--hd),-3px -3px 7px var(--hl)!important}
.hui .val,.hui .dim{color:#8d919c!important}
.hui .step button{background:var(--hb)!important;color:var(--ha)!important;box-shadow:3px 3px 7px var(--hd),-3px -3px 7px var(--hl)!important;border:0!important}
main.hui{padding-top:0!important;max-width:560px!important;min-height:100vh}
.hui .card{background:var(--hb)!important;border-radius:22px!important;box-shadow:8px 8px 18px var(--hd),-8px -8px 18px var(--hl)!important;margin:16px 0 0;padding:14px 18px!important}
.hui .card small{color:var(--hm)!important}
.hui .card .row{font-size:16px!important;min-height:40px}
.hui .card select,.hui .card input:not([type=checkbox]){background:var(--hb)!important;color:var(--ht)!important;border-radius:10px!important;box-shadow:inset 2px 2px 5px var(--hd),inset -2px -2px 5px var(--hl)}
.hui .hui-pane>button{display:block;width:100%;margin:14px 0 0;height:52px;border-radius:18px!important;border:0;background:var(--hb)!important;color:var(--ha)!important;
  font:600 17px -apple-system,system-ui!important;box-shadow:6px 6px 14px var(--hd),-6px -6px 14px var(--hl)!important}
.hui .hui-pane>button:active{box-shadow:inset 4px 4px 9px var(--hd),inset -4px -4px 9px var(--hl)!important}
.hui .hui-pane>small{display:block;margin:12px 6px 0;color:var(--hm)!important}
.hui .dot{box-shadow:0 0 6px currentColor}
`;
function norm(t){return String(t||'').replace(/\s+/g,' ').trim().toLowerCase()}
function build(box){
  if(box.classList.contains('hui'))return;
  let cfg={};try{cfg=JSON.parse(box.getAttribute('data-hui')||'{}')}catch(e){}
  const tabs=(cfg.tabs||[]).map(t=>({n:t.n,i:t.i||'more',s:(t.s||[]).map(norm),el:null,btn:null}));
  if(!tabs.length)tabs.push({n:'Settings',i:'more',s:[]});
  if(!document.getElementById('hui-css')){const st=document.createElement('style');st.id='hui-css';st.textContent=CSS;document.head.appendChild(st)}
  /* 1. card = .lbl + the .grp / .seg right after it */
  box.querySelectorAll('.lbl').forEach(l=>{
    const n=l.nextElementSibling;if(!n||!(n.classList.contains('grp')||n.classList.contains('seg')))return;
    const c=document.createElement('div');c.className='hui-card';l.parentNode.insertBefore(c,l);c.appendChild(l);
    let x=c.nextElementSibling;while(x&&(x.classList.contains('grp')||x.classList.contains('seg'))){const nx=x.nextElementSibling;c.appendChild(x);x=nx}});
  /* 2. sections from the top-level children */
  const head=box.querySelector(':scope>.shead,:scope>.hd,:scope>h1');
  const kids=[...box.children].filter(e=>!e.matches('.grab,.shead,.hd,script,style,input[type=file]')&&e!==head);
  const secs=[];let cur=null,lead=[];
  const titleOf=e=>{const l=e.matches('.lbl')?e:e.querySelector('.lbl');return l?norm(l.textContent):null};
  kids.forEach(e=>{
    const t=e.getAttribute('data-tab')?'#'+e.getAttribute('data-tab'):titleOf(e);
    if(t!=null&&(e.matches('.lbl,.hui-card')||e.getAttribute('data-tab')||!cur)){cur={t,els:lead.concat([e])};lead=[];secs.push(cur)}
    else if(cur)cur.els.push(e);else lead.push(e)});
  if(lead.length){if(secs.length)secs[0].els=lead.concat(secs[0].els);else secs.push({t:'',els:lead})}
  /* 3. header + tabs + panes */
  const top=document.createElement('div');top.className='hui-top';
  const row=document.createElement('div');row.className='hui-row';
  const tw=document.createElement('div');const title=document.createElement('div');title.className='hui-title';title.textContent=cfg.title||document.title||'Settings';
  const sub=document.createElement('div');sub.className='hui-sub';tw.appendChild(title);tw.appendChild(sub);row.appendChild(tw);
  const done=head&&head.querySelector('button');
  if(done){done.classList.add('hui-done');row.appendChild(done)}
  top.appendChild(row);
  const bar=document.createElement('div');bar.className='hui-tabs';if(tabs.length>1)top.appendChild(bar);
  box.insertBefore(top,box.firstChild);
  tabs.forEach((t,i)=>{t.el=document.createElement('div');t.el.className='hui-pane';box.appendChild(t.el);
    t.btn=document.createElement('button');t.btn.type='button';t.btn.innerHTML=svg(t.i)+'<span>'+t.n+'</span>';bar.appendChild(t.btn);
    t.btn.addEventListener('click',()=>show(i))});
  secs.forEach(s=>{
    let tab=null;
    if(s.t&&s.t[0]==='#')tab=tabs.find(t=>norm(t.n)===norm(s.t.slice(1)));
    if(!tab&&s.t)tab=tabs.find(t=>t.s.some(w=>s.t.startsWith(w)));
    (tab||tabs[tabs.length-1]).el.append(...s.els)});
  if(!cfg.ver){const vn=[...box.querySelectorAll('.note,.snote,small')].map(e=>e.textContent.trim()).find(t=>/^[\w ]+ v\d+$/.test(t));if(vn)cfg.ver=vn.split(' ').pop()}
  const KEY='hui-tab:'+location.pathname;
  function show(i){tabs.forEach((t,j)=>{t.el.classList.toggle('on',i===j);t.btn.classList.toggle('on',i===j)});
    sub.textContent=tabs.length>1?tabs[i].n+(cfg.ver?'  ·  '+cfg.ver:''):(cfg.ver||'Settings');box.scrollTop=0;try{localStorage.setItem(KEY,String(i))}catch(e){}}
  let start=0;try{start=+localStorage.getItem(KEY)||0}catch(e){}
  show(start<tabs.length?start:0);
  box.classList.add('hui')}
function init(){document.querySelectorAll('[data-hui]').forEach(build)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.HUI={build,init};
})();
