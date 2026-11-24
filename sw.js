/* Spoticar · service worker
   1) La app se abre al instante con lo guardado en el aparato y se pone al día por detrás (antes esperaba a la red hasta 3,5 s).
   2) Las fuentes de Google se guardan una vez y no se vuelven a pedir.
   3) ./stream/<id>: la canción empieza a sonar en cuanto llegan los primeros trozos de Drive. El acceso a Google va en la
      cabecera (nunca en la dirección) y, cuando termina de llegar, la canción se guarda entera en el aparato para la próxima vez. */
const V='guantera-v35',FONTS='gu-fonts-1',KEEP=[V,FONTS];
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./manifest-coche.webmanifest','./manifest-ordenador.webmanifest','./manifest-movil.webmanifest','./coche.html','./ordenador.html','./movil.html','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>!KEEP.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});

self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;let u;try{u=new URL(req.url);}catch(x){return;}
  if(u.origin===location.origin){const m=u.pathname.match(/\/stream\/([A-Za-z0-9_-]+)$/);
    if(m){e.respondWith(stream(e,m[1],+u.searchParams.get('z')||0));return;}
    if(/\/sw\.js$/.test(u.pathname))return;e.respondWith(shell(e,req,u));return;}
  if(u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com')e.respondWith(font(req));});

/* ---------- la app: primero lo guardado, y por detrás se trae la versión nueva ---------- */
async function shell(e,req,u){const c=await caches.open(V),nav=req.mode==='navigate',key=nav?u.origin+u.pathname:req;
  let hit=await c.match(key,{ignoreSearch:nav});if(!hit&&nav)hit=await c.match('./index.html');
  const net=fetch(nav?u.href:req.url,{cache:'no-cache',credentials:'same-origin'}).then(async r=>{
    if(r&&r.ok&&r.type==='basic'){const tag=x=>x&&(x.headers.get('last-modified')||x.headers.get('etag'))||'',old=tag(hit),neu=tag(r);
      await c.put(key,r.clone());if(nav&&old&&neu&&old!==neu)notify({t:'updated'});}
    return r;});
  if(hit){e.waitUntil(net.catch(()=>{}));return hit;}
  try{return await net;}catch(x){return(nav&&await c.match('./index.html'))||Response.error();}}

/* ---------- fuentes de Google ---------- */
async function font(req){const c=await caches.open(FONTS),hit=await c.match(req);if(hit)return hit;
  const r=await fetch(req);if(r&&(r.ok||r.type==='opaque'))c.put(req,r.clone()).catch(()=>{});return r;}

/* ---------- canciones guardadas (la misma base de datos que usa la app: spoticar-audio) ---------- */
let DBP=null;
function db(){return DBP||(DBP=new Promise((res,rej)=>{let r;try{r=indexedDB.open('spoticar-audio',1);}catch(x){DBP=null;return rej(x);}
  r.onupgradeneeded=()=>{const d=r.result;for(const n of ['b','m','k'])if(!d.objectStoreNames.contains(n))d.createObjectStore(n);};
  r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>{try{d.close();}catch(x){}DBP=null;};res(d);};
  r.onerror=()=>{DBP=null;rej(r.error);};r.onblocked=()=>{DBP=null;rej(new Error('blocked'));};}));}
function tx(st,mode,fn){return db().then(d=>new Promise((res,rej)=>{const t=d.transaction(st,mode),q=fn(t);t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);}));}
const get=(st,k)=>tx(st,'readonly',t=>t.objectStore(st).get(k));
const save=(id,b)=>tx(['b','m'],'readwrite',t=>{t.objectStore('b').put(b,id);t.objectStore('m').put({sz:b.size,at:Date.now(),last:Date.now()},id);});
const touch=id=>tx('m','readwrite',t=>{const s=t.objectStore('m'),r=s.get(id);r.onsuccess=()=>{const v=r.result;if(v){v.last=Date.now();s.put(v,id);}};}).catch(()=>{});
const notify=msg=>self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>cs.forEach(c=>{try{c.postMessage(msg);}catch(x){}})).catch(()=>{});

/* acceso a Google: lo manda la app por mensaje y se guarda aquí dentro (por si el navegador duerme este proceso) */
let TOK=null;
self.addEventListener('message',e=>{const d=e.data||{};if(d.t!=='tok')return;TOK=d.tok&&d.tok.t?d.tok:null;
  e.waitUntil(tx('k','readwrite',t=>t.objectStore('k').put(TOK,'tok')).catch(()=>{}).then(()=>{try{e.ports&&e.ports[0]&&e.ports[0].postMessage({ok:true});}catch(x){}}));});
async function getTok(){if(TOK&&TOK.e>Date.now()+10e3)return TOK.t;try{const t=await get('k','tok');if(t&&t.t&&t.e>Date.now()+10e3){TOK=t;return t.t;}}catch(x){}return null;}

/* trozo de una canción ya guardada (el reproductor pide «desde el byte tal») */
function part(b,range){const size=b.size,type=b.type||'audio/mpeg',m=/bytes=(\d*)-(\d*)/.exec(range||'');
  if(!m)return new Response(b,{status:200,headers:{'Content-Type':type,'Content-Length':String(size),'Accept-Ranges':'bytes'}});
  let s0,e0;if(m[1]===''){s0=Math.max(0,size-(+m[2]||0));e0=size-1;}else{s0=+m[1];e0=m[2]?Math.min(+m[2],size-1):size-1;}
  if(s0>=size||s0>e0)return new Response('',{status:416,headers:{'Content-Range':'bytes */'+size}});
  return new Response(b.slice(s0,e0+1,type),{status:206,headers:{'Content-Type':type,'Content-Length':String(e0-s0+1),'Content-Range':'bytes '+s0+'-'+e0+'/'+size,'Accept-Ranges':'bytes'}});}

async function stream(e,id,z){const range=e.request.headers.get('range')||'';
  try{const b=await get('b',id);if(b&&b.size){touch(id);return part(b,range);}}catch(x){}
  const tok=await getTok();if(!tok)return new Response('',{status:401,statusText:'Sin acceso'});
  const url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',m=/bytes=(\d*)-(\d*)/.exec(range),s0=m&&m[1]?+m[1]:0;
  /* un trozo suelto (saltar dentro de la canción): se le pide tal cual a Drive */
  if(m&&(s0>0||m[2]||m[1]==='')){let r;try{r=await fetch(url,{headers:{Authorization:'Bearer '+tok,Range:range}});}catch(x){return new Response('',{status:503});}
    const h=new Headers();for(const k of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.get(k))h.set(k,r.headers.get(k));
    const n=+r.headers.get('content-length')||0;if(r.status===206&&!h.get('content-range')&&n&&z)h.set('Content-Range','bytes '+s0+'-'+(s0+n-1)+'/'+z);
    return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});}
  /* la canción desde el principio: suena según llega y, al acabar, se guarda */
  const ab=new AbortController();let r;
  try{r=await fetch(url,{headers:{Authorization:'Bearer '+tok},signal:ab.signal});}catch(x){return new Response('',{status:503});}
  if(!r.ok||!r.body)return new Response('',{status:r.status||502});
  const len=+r.headers.get('content-length')||z||0,type=r.headers.get('content-type')||'audio/mpeg',rd=r.body.getReader(),parts=[];let got=0,gone=false,ctl;
  const out=new ReadableStream({start(c){ctl=c;},cancel(){gone=true;if(!len||got<len*.35){try{ab.abort();}catch(x){}}}}); // si la saltas pronto, se deja de bajar
  e.waitUntil((async()=>{try{for(;;){const x=await rd.read();if(x.done)break;parts.push(x.value);got+=x.value.byteLength;if(!gone){try{ctl.enqueue(x.value);}catch(y){gone=true;}}}
      if(!gone){try{ctl.close();}catch(y){}}
      if(got>50000&&(!len||got===len)){const b=new Blob(parts,{type});await save(id,b).catch(()=>{});notify({t:'cached',id,sz:b.size});}}
    catch(err){if(!gone){try{ctl.error(err);}catch(y){}}}})());
  const h=new Headers({'Content-Type':type,'Accept-Ranges':'bytes'});
  if(len){h.set('Content-Length',String(len));if(m){h.set('Content-Range','bytes 0-'+(len-1)+'/'+len);return new Response(out,{status:206,headers:h});}}
  return new Response(out,{status:200,headers:h});}
