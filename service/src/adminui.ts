// Single-file admin page. No external resources; DOM built with textContent only (no innerHTML).
export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Licence admin</title>
<style nonce="__NONCE__">
:root{--bg:#f6f7f9;--fg:#15181d;--mut:#667085;--card:#fff;--bd:#dfe3e8;--ac:#1d4ed8;--bad:#b42318;--ok:#067647;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e8eaed;--mut:#9aa4b2;--card:#181c22;--bd:#2b323b;--ac:#7aa2ff;--bad:#ff8a80;--ok:#57d69b;--warn:#ffb86b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,Segoe UI,sans-serif}
header{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd);background:var(--card);position:sticky;top:0}
header h1{font-size:17px;margin:0;flex:1}main{max-width:1100px;margin:0 auto;padding:16px}
button,input,select,textarea{font:inherit;color:inherit}
button{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:8px 12px;cursor:pointer}
button.p{background:var(--ac);border-color:var(--ac);color:#fff}button.d{color:var(--bad)}
input,select,textarea{width:100%;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--card)}
label{display:block;font-size:13px;color:var(--mut);margin:10px 0 3px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.grow{flex:1}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 12px}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--bd)}
.active{color:var(--ok)}.locked,.expired{color:var(--bad)}.unused{color:var(--warn)}
.mut{color:var(--mut);font-size:13px}.err{color:var(--bad);min-height:1.4em}
.code{font:600 18px ui-monospace,Consolas,monospace;letter-spacing:.5px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--bd)}
[hidden]{display:none!important}
</style></head><body>
<header><h1>Licence admin</h1><button id="out" hidden>Sign out</button></header>
<main>
<section id="login" class="card" hidden>
 <label>Password</label><input id="pw" type="password" autocomplete="current-password">
 <label>Authenticator code</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
 <p class="err" id="lerr"></p><button class="p" id="go">Sign in</button>
</section>
<section id="app" hidden>
 <div class="row" style="margin-bottom:12px"><button class="p" id="new">+ Create code</button><button id="reload">Refresh</button><button id="aud">Audit log</button></div>
 <div id="form" class="card" hidden></div>
 <div id="list"></div>
 <div id="detail" class="card" hidden></div>
</section>
</main>
<script nonce="__NONCE__">
"use strict";
const $=id=>document.getElementById(id);let csrf=null;
function h(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v)}for(const k of kids.flat())if(k!=null)e.append(k.nodeType?k:document.createTextNode(String(k)));return e}
const fmt=t=>t?new Date(t*1000).toISOString().replace("T"," ").slice(0,16)+"Z":"—";
async function api(path,method="GET",body){const r=await fetch("/admin/api"+path,{method,headers:{"content-type":"application/json","x-csrf-token":csrf||""},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(r.status===401&&path!=="/login"){show(false);throw new Error(j.message||"Signed out")}if(!r.ok)throw new Error(j.message||r.status);return j}
function show(inn){$("login").hidden=inn;$("app").hidden=!inn;$("out").hidden=!inn}
$("go").onclick=async()=>{$("lerr").textContent="";try{const j=await api("/login","POST",{password:$("pw").value,totp:$("totp").value});csrf=j.csrf;$("pw").value=$("totp").value="";show(true);load()}catch(e){$("lerr").textContent=e.message}};
$("out").onclick=async()=>{await api("/logout","POST");csrf=null;show(false)};
$("reload").onclick=()=>load();$("new").onclick=()=>createForm();$("aud").onclick=()=>audit();
async function load(){const{codes}=await api("/codes");const l=$("list");l.replaceChildren(...codes.map(c=>{
 const q=c.page_quota_month==null?"∞":c.page_quota_month;
 return h("div",{class:"card"},h("div",{class:"row"},h("b",{class:"grow"},c.customer),h("span",{class:"tag "+c.state},c.state)),
 h("div",{class:"mut"},"…"+c.last5+" · created "+fmt(c.created_at)+" · first used "+fmt(c.first_activated_at)+" · ends "+(c.ends_at?fmt(c.ends_at):c.valid_days?c.valid_days+" days from activation":"never")),
 h("div",{class:"mut"},"devices "+c.devices_used+"/"+c.max_devices+" · pages this month "+c.pages_month+"/"+q+" · last seen "+fmt(c.last_seen_at)+(c.locked_reason?" · lock reason: "+c.locked_reason:"")),
 h("div",{class:"row",style:"margin-top:8px"},
  c.status==="locked"?h("button",{onclick:()=>act(c.id,"unlock")},"Unlock"):h("button",{onclick:()=>{const r=prompt("Reason shown to the user (optional)");if(r!==null)act(c.id,"lock",{reason:r})}},"Lock"),
  h("button",{onclick:()=>{const d=prompt("Extend by how many days?","30");if(d)act(c.id,"extend",{days:parseInt(d,10)})}},"Extend"),
  h("button",{onclick:()=>confirm("Free all PCs for this code?")&&act(c.id,"reset-devices")},"Reset devices"),
  h("button",{onclick:()=>usage(c)},"Usage log"),
  h("button",{class:"d",onclick:()=>confirm("Delete "+c.customer+" permanently?")&&del(c.id)},"Delete")))}));
 if(!codes.length)l.replaceChildren(h("p",{class:"mut"},"No codes yet."))}
async function act(id,a,b){try{await api("/codes/"+id+"/"+a,"POST",b||{});load()}catch(e){alert(e.message)}}
async function del(id){try{await api("/codes/"+id,"DELETE");load()}catch(e){alert(e.message)}}
function createForm(){const f=$("form");f.hidden=false;
 const F=(l,el)=>[h("label",{},l),el];const cust=h("input",{}),notes=h("textarea",{rows:2}),mode=h("select",{},h("option",{value:"days"},"N days from first activation"),h("option",{value:"end"},"Fixed end date")),
 days=h("input",{type:"number",value:"365",min:1}),end=h("input",{type:"date"}),dev=h("input",{type:"number",value:"1",min:1}),lease=h("input",{type:"number",value:"72",min:1}),quota=h("input",{type:"number",placeholder:"blank = unlimited",min:0}),err=h("p",{class:"err"});
 end.hidden=true;mode.onchange=()=>{days.hidden=mode.value!=="days";end.hidden=!days.hidden};
 f.replaceChildren(h("b",{},"New code"),h("div",{class:"grid"},...F("Customer",cust),...F("Notes",notes),...F("Validity",mode),...F("Days / end date",h("div",{},days,end)),...F("PCs allowed",dev),...F("Offline grace (hours)",lease),...F("Pages per month",quota)),err,
 h("div",{class:"row"},h("button",{class:"p",onclick:async()=>{err.textContent="";try{const b={customer:cust.value,notes:notes.value,maxDevices:+dev.value,leaseHours:+lease.value,pageQuotaMonth:quota.value===""?null:+quota.value};if(mode.value==="days")b.validDays=+days.value;else b.fixedEnd=end.value;
  const r=await api("/codes","POST",b);const copy=h("button",{onclick:()=>navigator.clipboard.writeText(r.code).then(()=>copy.textContent="Copied")},"Copy");
  f.replaceChildren(h("b",{},"Code created for "+b.customer),h("p",{class:"code"},r.code),h("p",{class:"err"},"Shown only once — copy it now."),h("div",{class:"row"},copy,h("button",{onclick:()=>{f.hidden=true;load()}},"Done")))}catch(e){err.textContent=e.message}}},"Create"),h("button",{onclick:()=>f.hidden=true},"Cancel"))) }
async function usage(c){const d=$("detail");d.hidden=false;const j=await api("/codes/"+c.id+"/usage");
 d.replaceChildren(h("div",{class:"row"},h("b",{class:"grow"},"Usage — "+c.customer+" …"+c.last5),h("button",{onclick:()=>d.hidden=true},"Close")),
 h("p",{class:"mut"},"Devices: "+(j.devices.map(x=>"#"+x.id+" last seen "+fmt(x.last_seen)+" v"+(x.app_version||"?")).join(" · ")||"none")),
 h("table",{},h("tr",{},...["Time","Pages","Model","OK","Error"].map(x=>h("th",{},x))),...j.usage.map(u=>h("tr",{},h("td",{},fmt(u.ts)),h("td",{},u.pages),h("td",{},u.model||""),h("td",{},u.ok?"yes":"no"),h("td",{},u.error||"")))),
 h("p",{},h("b",{},"Events")),h("table",{},...j.audit.map(a=>h("tr",{},h("td",{},fmt(a.ts)),h("td",{},a.actor),h("td",{},a.action),h("td",{},a.ip||""),h("td",{},a.detail||"")))));d.scrollIntoView()}
async function audit(){const d=$("detail");d.hidden=false;const j=await api("/audit");d.replaceChildren(h("div",{class:"row"},h("b",{class:"grow"},"Audit log (latest 200)"),h("button",{onclick:()=>d.hidden=true},"Close")),
 h("table",{},...j.audit.map(a=>h("tr",{},h("td",{},fmt(a.ts)),h("td",{},a.actor),h("td",{},a.action),h("td",{},a.code_id??""),h("td",{},a.ip||""),h("td",{},a.detail||"")))))}
api("/session").then(j=>{csrf=j.csrf;show(true);load()}).catch(()=>show(false));
</script></body></html>`;
