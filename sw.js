const V='guantera-v8';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const req=e.request;const u=new URL(req.url);if(req.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith((async()=>{const cache=await caches.open(V);
    const net=fetch(req,{cache:'no-cache'}).then(r=>{if(r.ok)cache.put(req,r.clone());return r;});
    const timeout=new Promise(res=>setTimeout(res,3500));
    try{const r=await Promise.race([net,timeout]);if(r)return r;}catch{}
    const hit=await cache.match(req,{ignoreSearch:true})||(req.mode==='navigate'?await cache.match('./index.html'):null);
    return hit||net;})());});
