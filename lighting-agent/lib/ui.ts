// The agent's small local page (http://127.0.0.1:8750/, opened with `racingcoach-lighting ui`): status, scenes,
// modes, zones and the pit limiter test. The local token comes in the address's #fragment, which browsers never send
// to a server, and is kept in this tab's sessionStorage only. All the full configuration is on the website's Admin
// page; this page is for checking the agent and controlling the lights when the website isn't there.

export const UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RacingCoach Lighting</title>
<style>
:root{color-scheme:dark;--bg:#0d0b0c;--card:#17181c;--b:#2c2e35;--fg:#f3f4f6;--mu:#9a9ca3;--red:#e10600;--blue:#1e6bff}
*{box-sizing:border-box}body{margin:0;font:14px system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:16px;max-width:960px;margin:auto}
h1{font-size:18px;letter-spacing:.06em;text-transform:uppercase}h1 span{color:var(--red)}
section{background:var(--card);border:1px solid var(--b);border-radius:10px;padding:14px;margin:12px 0}
h2{font-size:12px;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px}
button{background:#22242b;color:var(--fg);border:1px solid var(--b);border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer;margin:0 6px 6px 0}
button.on{border-color:var(--red);color:#fff}button:hover{border-color:var(--mu)}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--b)}.row:first-child{border-top:0}
.sw{width:18px;height:18px;border-radius:4px;border:1px solid var(--b)}.mu{color:var(--mu)}.lit{background:var(--blue);color:#fff;padding:3px 8px;border-radius:5px;font-weight:700}
input[type=range]{width:120px}
</style></head><body>
<h1>RacingCoach <span>Lighting</span></h1>
<p id="msg" class="mu">Loading...</p>
<section><h2>Status</h2><div id="status"></div></section>
<section><h2>Mode</h2><div id="modes"></div></section>
<section><h2>Scenes</h2><div id="scenes"></div></section>
<section><h2>Zones</h2><div id="zones"></div></section>
<section><h2>Test</h2>
<button onclick="post('/test/pit-limiter',{active:true})">Pit limiter on</button>
<button onclick="post('/test/pit-limiter',{active:false})">Pit limiter off</button>
<button onclick="post('/restore',{what:'baseline'})">Restore baseline</button>
<button onclick="post('/all-off',{})">All off</button><button onclick="post('/all-on',{})">All on</button>
<button onclick="post('/brightness',{action:'decrease'})">Brightness -</button><button onclick="post('/brightness',{action:'increase'})">Brightness +</button>
</section>
<script>
const h=location.hash.match(/token=([A-Za-z0-9_-]+)/);if(h){sessionStorage.setItem('t',h[1]);history.replaceState(null,'','/')}
const token=sessionStorage.getItem('t');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(p,o={}){const r=await fetch(p,{...o,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function post(p,b){try{await api(p,{method:'POST',body:JSON.stringify(b)});load()}catch(e){msg.textContent=e.message}}
const hex=c=>'#'+c.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
async function load(){
 if(!token){msg.textContent='Open this page with: racingcoach-lighting ui';return}
 try{const s=await api('/status');const sc=await api('/scenes');msg.textContent='';
  status.innerHTML='Site: <b>'+esc(s.site)+'</b> · Telemetry: <b>'+(s.telemetryFresh?'fresh':'stale')+'</b> · Override: '+(s.activeOverride?'<span class=lit>'+esc(s.activeOverride)+'</span>':'none')+
   ' · Brightness '+Math.round(s.masterBrightness*100)+'%<br><span class=mu>'+s.controllers.map(c=>esc(c.name)+': '+(c.online?'online':'offline')+(c.latencyMs!=null?' ('+c.latencyMs+' ms)':'')).join(' · ')+
   (s.lastEventLatencyMs!=null?' · last event '+s.lastEventLatencyMs+' ms from the server':'')+'</span>';
  modes.innerHTML=['AUTOMATIC','MANUAL','TEST','DISABLED'].map(m=>'<button class="'+(s.mode===m?'on':'')+'" onclick="post(\\'/mode\\',{mode:\\''+m+'\\'})">'+m+'</button>').join('');
  scenes.innerHTML=sc.scenes.map(x=>'<button class="'+(sc.active===x.id?'on':'')+'" onclick="post(\\'/scenes/'+esc(x.id)+'/activate\\',{})">'+esc(x.name)+'</button>').join('');
  zones.innerHTML=s.zones.map(z=>{const d=z.desired;return '<div class=row><span class=sw style="background:'+(d&&d.on?hex(d.color):'#000')+'"></span><b>'+esc(z.name)+'</b>'+
   (z.enabled?'':' <span class=mu>disabled</span>')+(z.protected?' <span class=mu>protected</span>':'')+' <span class=mu>'+esc(z.reason)+'</span>'+
   (z.enabled?' <button onclick="post(\\'/zones/'+esc(z.id)+'/state\\',{toggle:true})">Toggle</button><input type=color value="'+(d?hex(d.color):'#ffffff')+'" onchange="post(\\'/zones/'+esc(z.id)+'/state\\',{color:this.value.slice(1)+\\'00\\'})">'+
   '<input type=range min=0 max=255 value="'+(d?d.brightness:128)+'" onchange="post(\\'/zones/'+esc(z.id)+'/state\\',{brightness:+this.value})">':'')+'</div>'}).join('');
 }catch(e){msg.textContent='Agent: '+e.message}}
load();setInterval(load,2000);
</script></body></html>`;
