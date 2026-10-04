// License Manager: a single self-contained page served by the licensing server at /manager.
// The admin token is typed in and kept in memory only (never stored). DOM is built with textContent (no innerHTML).
export const MANAGER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>License Manager</title>
<style nonce="__NONCE__">
:root{--bg:#f6f7f9;--fg:#15181d;--mut:#667085;--card:#fff;--bd:#dfe3e8;--ac:#1d4ed8;--bad:#b42318;--ok:#067647;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e8eaed;--mut:#9aa4b2;--card:#181c22;--bd:#2b323b;--ac:#7aa2ff;--bad:#ff8a80;--ok:#57d69b;--warn:#ffb86b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,Segoe UI,sans-serif}
header{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd);background:var(--card)}header h1{font-size:17px;margin:0;flex:1}
main{max-width:1100px;margin:0 auto;padding:16px}button,input,select,textarea{font:inherit;color:inherit}
button{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:7px 12px;cursor:pointer}button.p{background:var(--ac);border-color:var(--ac);color:#fff}button.d{color:var(--bad)}
input,select,textarea{width:100%;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--card)}label{display:block;font-size:13px;color:var(--mut);margin:10px 0 3px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:12px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.grow{flex:1}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--bd)}.active{color:var(--ok)}.revoked,.expired{color:var(--bad)}.suspended{color:var(--warn)}
.mut{color:var(--mut);font-size:13px}.err{color:var(--bad);min-height:1.4em}.code{font:600 13px ui-monospace,Consolas,monospace;word-break:break-all;background:var(--bg);padding:8px;border-radius:8px}
label.radio{display:inline-flex;align-items:center;gap:6px;margin:0 18px 0 0;color:var(--fg);font-size:15px}label.radio input{width:auto}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.small{font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--bd)}[hidden]{display:none!important}
</style></head><body>
<header><h1>License Manager</h1><button id="out" hidden>Sign out</button></header>
<main>
<section id="login" class="card"><label for="tok">Admin token</label><input id="tok" type="password" autocomplete="off"><p class="err" id="lerr"></p><button class="p" id="go">Sign in</button>
<p class="mut">The token is only kept in this page's memory.</p></section>
<section id="app" hidden>
 <div class="row" style="margin-bottom:12px"><button class="p" id="new">+ New licence</button><button id="reload">Refresh</button><button id="aud">Audit log</button></div>
 <div id="provider" class="card"></div>
 <div id="form" class="card" hidden></div><div id="list"></div><div id="detail" class="card" hidden></div>
</section></main>
<script nonce="__NONCE__">
"use strict";
const $=id=>document.getElementById(id);let token=null;
function h(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v)}for(const k of kids.flat())if(k!=null)e.append(k.nodeType?k:document.createTextNode(String(k)));return e}
const fmt=t=>t?String(t).replace("T"," ").slice(0,16)+"Z":"—";
async function api(path,method="GET",body){const r=await fetch("/admin/v1"+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||r.status);return j}
$("go").onclick=async()=>{token=$("tok").value;$("tok").value="";try{await api("/info");$("login").hidden=true;$("app").hidden=false;$("out").hidden=false;load();provider()}catch(e){token=null;$("lerr").textContent=e.message}};
$("out").onclick=()=>{token=null;$("app").hidden=true;$("out").hidden=true;$("login").hidden=false};$("reload").onclick=load;$("new").onclick=form;$("aud").onclick=()=>audit();
let flash="";
async function provider(){const box=$("provider");let p;try{p=await api("/provider")}catch(e){box.replaceChildren(h("p",{class:"err"},e.message));return}
 const radio=(v,l)=>h("label",{class:"radio"},h("input",{type:"radio",name:"prov",value:v,checked:p.provider===v}),l);
 const key=(name)=>h("input",{type:"password",autocomplete:"off",placeholder:p[name].configured?"saved "+p[name].keyHint+" (type to replace)":"paste API key",id:"key-"+name});
 const mb=(name)=>h("input",{id:"mb-"+name,list:"models-"+name,value:p[name].modelBest||""}),mf=(name)=>h("input",{id:"mf-"+name,list:"models-"+name,value:p[name].modelFast||""});
 const out=h("p",{class:"mut",role:"status"},flash),err=h("p",{class:"err"});flash="";
 const sel=()=>box.querySelector("input[name=prov]:checked").value;
 const section=(name,title)=>h("div",{style:"margin-top:12px"},h("b",{},title),h("span",{class:"mut"}," · "+(p[name].configured?"key "+p[name].keyHint+" ("+(p[name].source==="stored"?"saved here":"from server settings")+")":"no key")),
  h("label",{for:"key-"+name},"API key (write-only, never shown again)"),key(name),h("div",{class:"grid2"},h("div",{},h("label",{for:"mb-"+name},"Model for “Best accuracy”"),mb(name)),h("div",{},h("label",{for:"mf-"+name},"Model for “Faster”"),mf(name))),h("datalist",{id:"models-"+name}),
  h("div",{class:"row",style:"margin-top:8px"},h("button",{onclick:async()=>{out.textContent="Testing…";err.textContent="";try{const r=await api("/provider/test","POST",{provider:name});out.textContent=(r.ok?"✓ ":"✗ ")+r.message+(r.models.length?" ("+r.models.length+" models listed in the model boxes)":"");const dl=$("models-"+name);dl.replaceChildren(...r.models.map(m=>h("option",{value:m})))}catch(e){err.textContent=e.message}}},"Test connection"),
   p[name].source==="stored"?h("button",{class:"d",onclick:async()=>{if(!confirm("Remove the saved "+title+" key from this server?"))return;try{await api("/provider","POST",{[name]:{clearKey:true}});flash="Saved key removed.";provider()}catch(e){err.textContent=e.message}}},"Remove saved key"):null));
 box.replaceChildren(h("b",{},"Reading provider"),h("p",{class:"mut"},"Which AI service reads the handwriting. The key stays on this server (stored encrypted) and is never sent to customers' apps."),
  h("div",{},radio("anthropic","Anthropic (Claude)"),radio("groq","Groq")),section("anthropic","Anthropic"),section("groq","Groq"),
  h("p",{class:"mut small"},"Groq: choose a model that accepts images. “Test connection” lists the models your key can use. Reading quality differs between providers: compare with a few real sheets before switching customers over."),
  h("div",{class:"row"},h("button",{class:"p",onclick:async()=>{err.textContent="";out.textContent="";const body={provider:sel()};for(const name of["anthropic","groq"]){const k=$("key-"+name).value.trim();body[name]={modelBest:$("mb-"+name).value,modelFast:$("mf-"+name).value};if(k)body[name].apiKey=k}
   try{await api("/provider","POST",body);flash="Saved.";provider()}catch(e){err.textContent=e.message}}},"Save"),out),err)}
async function load(){const{licenses}=await api("/licenses");const l=$("list");l.replaceChildren(...licenses.map(c=>h("div",{class:"card"},
 h("div",{class:"row"},h("b",{class:"grow"},c.customer+(c.company?" · "+c.company:"")),h("span",{class:"tag "+c.state},c.state),h("span",{class:"tag"},c.offline?"offline":"online")),
 h("div",{class:"mut"},c.license_id+" · ends "+(c.effective_expires_at?fmt(c.effective_expires_at):"never")+" · machines "+c.active_count+"/"+c.max_activations+" · last seen "+fmt(c.last_seen)),
 h("div",{class:"row",style:"margin-top:8px"},h("button",{onclick:()=>detail(c.license_id)},"Open")))));if(!licenses.length)l.replaceChildren(h("p",{class:"mut"},"No licences yet. Import a code or create one."))}
async function detail(id){const d=$("detail");d.hidden=false;const j=await api("/licenses/"+encodeURIComponent(id));const c=j.license;
 const act=(a,b,confirmMsg)=>async()=>{if(confirmMsg&&!confirm(confirmMsg))return;try{await api("/licenses/"+encodeURIComponent(id)+"/"+a,"POST",b||{});await load();detail(id)}catch(e){alert(e.message)}};
 d.replaceChildren(h("div",{class:"row"},h("b",{class:"grow"},c.customer+" · "+c.license_id),h("button",{onclick:()=>d.hidden=true},"Close")),
  h("p",{class:"mut"},"status "+c.state+(c.status_reason?" ("+c.status_reason+")":"")+" · ends "+(j.license.effective_expires_at?fmt(j.license.effective_expires_at):"never")+" · grace "+c.grace_hours+" h · replacement "+(c.replacement_ok?"allowed":"no")+" · authorised machines "+j.authorized),
  h("div",{class:"row"},
   c.status==="active"?[h("button",{onclick:act("suspend",{reason:prompt("Reason shown to the customer (optional)")||""})},"Suspend"),h("button",{class:"d",onclick:()=>{const r=prompt("Reason shown to the customer (optional)");if(r!==null)act("revoke",{reason:r})()}},"Revoke")]:h("button",{onclick:act("reinstate")},"Reinstate"),
   h("button",{onclick:()=>{const d=prompt("Extend by how many days?","30");if(d)act("extend",{days:parseInt(d,10)})()}},"Extend"),
   h("button",{onclick:()=>{const d=prompt("New expiry date (YYYY-MM-DD) or 'never'");if(d)act("renew",{expiresAt:d==="never"?null:new Date(d+"T23:59:59Z").toISOString()})()}},"Renew / set expiry"),
   h("button",{onclick:act("replacement",{},"Allow the NEXT new computer to replace the current one(s)?")},"Allow replacement"),
   h("button",{onclick:act("reset",{},"Deactivate every computer of this licence?")},"Reset activations"),
   h("button",{onclick:()=>{const m=prompt("Paste the customer's Machine ID (MID1.…)");if(m)act("authorize-machine",{machineId:m})()}},"Authorise machine"),
   h("button",{onclick:()=>{const g=prompt("Offline grace period in hours",String(c.grace_hours));if(g)act("set-grace",{hours:parseInt(g,10)})()}},"Grace period"),
   h("button",{class:"d",onclick:act("delete",{},"Delete this licence and its activations?")},"Delete")),
  h("p",{},h("b",{},"Computers")),h("table",{},h("tr",{},...["Machine","First seen","Last seen","Version","State"].map(x=>h("th",{},x))),...j.activations.map(a=>h("tr",{},h("td",{},a.machine_hash.slice(0,12)),h("td",{},fmt(a.first_seen)),h("td",{},fmt(a.last_seen)),h("td",{},a.app_version||""),h("td",{},a.active?"active":(a.ended_reason||"ended"))))),
  h("div",{class:"row"},h("button",{onclick:()=>audit(id)},"Events"),h("button",{onclick:()=>usage(id)},"Page usage")));d.scrollIntoView()}
async function usage(id){const d=$("detail");const j=await api("/usage/"+encodeURIComponent(id));d.append(h("table",{},h("tr",{},...["Time","Pages","Model","Tokens in/out","OK","Error"].map(x=>h("th",{},x))),...j.usage.map(u=>h("tr",{},h("td",{},fmt(u.ts)),h("td",{},u.pages),h("td",{},u.model||""),h("td",{},u.tokens_in!=null?u.tokens_in+" / "+u.tokens_out:""),h("td",{},u.ok?"yes":"no"),h("td",{},u.error||"")))))}
async function audit(id){const d=$("detail");d.hidden=false;const j=await api("/audit"+(id?"?license="+encodeURIComponent(id):""));d.append(h("table",{},...j.audit.map(a=>h("tr",{},h("td",{},fmt(a.ts)),h("td",{},a.actor),h("td",{},a.action),h("td",{},a.license_id||""),h("td",{},a.ip||""),h("td",{},a.detail||"")))))}
async function form(){const f=$("form");f.hidden=false;const info=await api("/info");
 const code=h("textarea",{rows:3,placeholder:"LSR1.…"}),err=h("p",{class:"err"});
 const imp=h("div",{},h("b",{},"Import a code signed on your PC (recommended)"),h("label",{},"Activation code"),code,h("div",{class:"row",style:"margin-top:8px"},h("button",{class:"p",onclick:async()=>{err.textContent="";try{await api("/licenses","POST",{code:code.value});f.hidden=true;load()}catch(e){err.textContent=e.message}}},"Import")),err);
 if(!info.issuer){f.replaceChildren(imp,h("p",{class:"mut"},"This server has no signing key, so it cannot create codes. Use scripts/offline-license.sh on your PC, then paste the code above."),h("button",{onclick:()=>f.hidden=true},"Cancel"));return}
 const cust=h("input",{}),comp=h("input",{}),days=h("input",{type:"number",placeholder:"blank = never expires"}),max=h("input",{type:"number",value:"1",min:1}),mid=h("input",{placeholder:"MID1.… (required for offline)"}),off=h("input",{type:"checkbox"}),err2=h("p",{class:"err"});
 f.replaceChildren(imp,h("hr"),h("b",{},"Create here (server holds a signing key)"),h("label",{},"Customer"),cust,h("label",{},"Company"),comp,h("label",{},"Valid for (days)"),days,h("label",{},"Computers allowed"),max,h("label",{},"Machine ID (optional; binds to one PC)"),mid,h("label",{},h("span",{},"Offline licence "),off),
  h("div",{class:"row",style:"margin-top:8px"},h("button",{class:"p",onclick:async()=>{err2.textContent="";try{const r=await api("/licenses","POST",{customer:cust.value,company:comp.value,days:days.value?+days.value:undefined,maxActivations:+max.value,machineId:mid.value||undefined,offline:off.checked});
   const copy=h("button",{onclick:()=>navigator.clipboard.writeText(r.code).then(()=>copy.textContent="Copied")},"Copy");f.replaceChildren(h("b",{},"Created "+r.licenseId),h("p",{class:"code"},r.code),h("p",{class:"err"},"Copy it now and send it to the customer."),h("div",{class:"row"},copy,h("button",{onclick:()=>{f.hidden=true;load()}},"Done")))}catch(e){err2.textContent=e.message}}},"Create"),h("button",{onclick:()=>f.hidden=true},"Cancel")),err2)}
</script></body></html>`;
