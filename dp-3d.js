/* dp-3d.js — 3B Sunum modu (MapLibre). Bağımsız kullanım: dp-3d.html'i açın (dp-3d.js ve dp-3d.css aynı klasörde olmalı).
   Ana uygulamaya gömmek isterseniz: <link rel="stylesheet" href="dp-3d.css"><script src="dp-3d.js" defer></script> */
/* DP-3D: MapLibre tabanlı "3B Sunum" modu — Leaflet'ten bağımsız, lazy-load */
(function(){
'use strict';
var V='4.7.1',CFG={
  sat:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', // ESRI kullanım şartlarını doğrulayın
  dem:'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', // AWS Terrain Tiles (terrarium) — erişimi doğrulayın
  exag:1.2,
  ofm:'https://tiles.openfreemap.org/planet', // OpenFreeMap vektör karo (anahtarsız, ücretsiz; OSM bina verisi)
  ofmAttr:'<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
};
var TH=null,thr=null,outC=null,octx=null,cine=null,lastT=0,ofmErr=0,lib=null,m=null,raf=0,orbit=true,rec=null,chunks=[];
function $(i){return document.getElementById(i);}
function load(){if(lib)return lib;lib=new Promise(function(ok,no){
  var l=document.createElement('link');l.rel='stylesheet';l.href='https://cdn.jsdelivr.net/npm/maplibre-gl@'+V+'/dist/maplibre-gl.css';document.head.appendChild(l);
  var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/maplibre-gl@'+V+'/dist/maplibre-gl.js';
  s.onload=ok;s.onerror=function(){lib=null;no(new Error('MapLibre yüklenemedi (CDN/ağ). Bağlantıyı kontrol edin.'));};document.head.appendChild(s);});return lib;}
function nk(k){return String(k).toUpperCase().replace(/İ/g,'I').replace(/[^A-Z0-9]/g,'');}
function num(v){var n=parseFloat(String(v).replace(',','.'));return isFinite(n)&&n>0?n:null;}
/* GeoJSON/KML özelliklerinden TAKS (alan adı dosyada varsa): varsa seçili parselin çizimi TAKS oranında küçültülür. */
function imar(p){var pr=(p.feature&&p.feature.properties)||{},o={};
  Object.keys(pr).forEach(function(k){var K=nk(k),v=num(pr[k]);if(v==null)return;
    if(/^(TAKS|TABANALANKATSAYISI)$/.test(K))o.taks=v;});
  if(o.taks>1)o.taks=o.taks/100;return o;}
function mtKey(){try{return localStorage.getItem('dpmt')||'';}catch(e){return '';}}
function bkp(){var k=mtKey();
  if(!k){say('⚠ OpenFreeMap bina verisi alınamadı. Yedek için 🔑 ile MapTiler anahtarı girin.');return;}
  try{if(m.getLayer('bldg'))m.removeLayer('bldg');if(m.getSource('ofm'))m.removeSource('ofm');
    m.addSource('mt',{type:'vector',url:'https://api.maptiler.com/tiles/v3/tiles.json?key='+encodeURIComponent(k),attribution:'© MapTiler © OpenStreetMap contributors'});
    m.addLayer({id:'bldg',type:'fill-extrusion',source:'mt','source-layer':'building',minzoom:14,filter:['!=',['get','hide_3d'],true],
      paint:{'fill-extrusion-color':'#E5E7EB','fill-extrusion-opacity':.85,'fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0]}},'edge');
    say('Yedek bina kaynağı: MapTiler');}catch(e){say('⚠ MapTiler yedeği kurulamadı: '+e.message);}}
function say(t){var e=$('d3Msg');if(e)e.textContent=t||'';}
function ui(){var d=document.createElement('div');d.id='dp3d';
  d.innerHTML='<div id="d3Map"></div><div id="d3Bar"><button class="d3b" onclick="DP3D.close()">✕ Kapat</button>'+
  '<label>Kamera açısı <input type="range" min="0" max="80" value="60" oninput="DP3D.pitch(this.value)"></label>'+
  '<button class="d3b" onclick="DP3D.key()">🔑 MapTiler</button><button class="d3b" id="d3B" onclick="DP3D.bld()">🏢 Binalar: açık</button><button class="d3b" id="d3O" onclick="DP3D.toggleOrbit()">⟳ Orbit: açık</button><select class="d3b" id="d3T" onchange="DP3D.time(this.value)"><option value="altin">🌇 Altın saat</option><option value="ogle">☀ Öğle</option><option value="aksam">🌆 Akşam</option></select><button class="d3b" id="d3S" onclick="DP3D.shadow()">Gölge: açık</button><button class="d3b" onclick="DP3D.dbg()">🐞 Test</button><span id="d3Sun"></span><select class="d3b" id="d3F"><option value="9:16">9:16 dikey</option><option value="16:9">16:9 yatay</option></select><button class="d3b" id="d3C" onclick="DP3D.cine()">🎬 Sinematik 20 sn</button><button class="d3b" id="d3R" onclick="DP3D.rec()">● Serbest kayıt</button><span id="d3Msg"></span></div>';
  document.body.appendChild(d);}
function ease(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;}
function frame(ts){raf=requestAnimationFrame(frame);var dt=lastT?Math.min(.1,(ts-lastT)/1000):0;lastT=ts;if(!m)return;
  if(cine)cineStep();else if(orbit)m.setBearing((m.getBearing()+12*dt)%360);   // serbest orbit ~12°/sn
  if(outC)compose();}
/* Sinematik yol (20 sn): uzaktan yakına, eğim artar, 270° dönüş */
function cineStep(){var t=(performance.now()-cine.t0)/1000;if(t>=20){stopRec();return;}
  var a=ease(Math.min(1,t/12)),v=Math.max(0,Math.min(1,(t-12)/8));
  m.jumpTo({center:cine.c,zoom:15.2+2*a+0.6*v,pitch:30+26*a+4*v,bearing:cine.b0+200*a+70*v});}
/* ── Three.js özel katman: gerçek zamanlı güneş gölgesi + mimari cephe dokusu ── */
function loadThree(){if(thr)return thr;thr=new Promise(function(ok,no){var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';s.onload=ok;s.onerror=function(){thr=null;no(new Error('Three.js yüklenemedi'));};document.head.appendChild(s);});return thr;}
function sunPos(date,lat,lng){var R=Math.PI/180,d=date/864e5-0.5+2440588-2451545,M=R*(357.5291+0.98560028*d),
  C=R*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M)),L=M+C+R*102.9372+Math.PI,dec=Math.asin(Math.sin(R*23.4397)*Math.sin(L)),
  ra=Math.atan2(Math.sin(L)*Math.cos(R*23.4397),Math.cos(L)),H=R*(280.16+360.9856235*d)+R*lng-ra,phi=R*lat;
  return {az:(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))/R+180+360)%360,   // kuzeyden saat yönünde
          el:Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H))/R};}
var PRE={altin:{t:12,sky:'#8FB8E8',hor:'#FFD59A',fog:'#F5C98A',amb:.55,col:0xffd9a0,int:1.7},
         ogle:{t:null,sky:'#5AA7F0',hor:'#EAF4FF',fog:'#DCEBFA',amb:.75,col:0xffffff,int:2.2},
         aksam:{t:3,sky:'#3F4F86',hor:'#F28C6B',fog:'#B77A8E',amb:.4,col:0xff9d6b,int:1.2}};
function when(key){var lat=TH.org[1],lng=TH.org[0],d0=new Date();d0.setHours(0,0,0,0);var best=null,t,e;
  for(var i=0;i<1440;i+=5){t=d0.getTime()+i*6e4;e=sunPos(new Date(t),lat,lng).el;if(!best||e>best.el)best={t:t,el:e};}
  if(key==='ogle')return new Date(best.t);
  for(t=best.t;t<best.t+10*36e5;t+=3e5){if(sunPos(new Date(t),lat,lng).el<=PRE[key].t)return new Date(t);}
  return new Date(best.t);}
function applyTime(key){if(!TH||!TH.sun)return;var P=PRE[key]||PRE.altin,dt=when(key),sp=sunPos(dt,TH.org[1],TH.org[0]),
  az=sp.az*Math.PI/180,el=Math.max(sp.el,1)*Math.PI/180,E=Math.sin(az)*Math.cos(el),N=Math.cos(az)*Math.cos(el),U=Math.sin(el);
  TH.dir=new THREE.Vector3(E,U,-N);rig();TH.sun.color.setHex(P.col);TH.sun.intensity=P.int;TH.amb.intensity=P.amb;   // three: x=doğu, y=yukarı, z=güney
  try{m.setSky({'sky-color':P.sky,'horizon-color':P.hor,'fog-color':P.fog,'sky-horizon-blend':.5,'horizon-fog-blend':.6,'fog-ground-blend':.5});}catch(e){}
  var s=$('d3Sun');if(s)s.textContent='☀ '+dt.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})+' · azimut '+Math.round(sp.az)+'° · yükseklik '+Math.round(sp.el)+'°';
  TH.key=key;m.triggerRepaint();}
/* Güneş + gölge zemini: sahne orijini = parsel merkezinin SABİT Mercator (x,y) koordinatı (TH.oc). Kamera/bearing burada hiç okunmaz.
   Işık konumu = hedef + yön×600; hedef ve zemin dünya eksenine bağlıdır; yalnızca azimut/yükseklik (TH.dir) veya kot (TH.cOff) değişince güncellenir. */
function rig(){if(!TH||!TH.sun||!TH.dir)return;var gy=TH.cOff||0;
  TH.sun.target.position.set(0,gy,0);TH.sun.position.set(TH.dir.x*600,gy+TH.dir.y*600,TH.dir.z*600);
  TH.sun.target.updateMatrixWorld();TH.sun.updateMatrixWorld();
  if(TH.ground)TH.ground.position.set(0,0,0);
  TH.dirty=true;m.triggerRepaint();}
function elevAt(q){var e;try{e=m.queryTerrainElevation(q,{exaggerated:true});}catch(x){return null;}return(typeof e==='number'&&isFinite(e))?e:null;}   // DEM yüklü değilse null
function groundFit(){if(!TH||!TH.ground)return;   // gölge zeminin her köşesini DEM kotuna (+0,35 m) oturt
  var pos=TH.ground.geometry.attributes.position,n=pos.count,ys=new Array(n),sum=0,i,ll,e;
  for(i=0;i<n;i++){ll=new maplibregl.MercatorCoordinate(TH.oc.x+pos.getX(i)*TH.s,TH.oc.y+pos.getZ(i)*TH.s,0).toLngLat();e=elevAt([ll.lng,ll.lat]);ys[i]=(e===null?TH.cE:e)-TH.alt+.35;sum+=ys[i];}
  if(TH.gSum!==undefined&&Math.abs(sum-TH.gSum)<1)return;TH.gSum=sum;
  for(i=0;i<n;i++)pos.setY(i,ys[i]);pos.needsUpdate=true;TH.ground.geometry.computeBoundingSphere();TH.dirty=true;m.triggerRepaint();}
function placeNb(){if(!TH||!TH.nbm)return;TH.nbm.forEach(function(ms){var e=elevAt(ms.userData.q);ms.position.y=ms.userData.b+((e===null?TH.cE:e)-TH.alt);});}
function local(q){var c=maplibregl.MercatorCoordinate.fromLngLat(q,0);return {x:(c.x-TH.oc.x)/TH.s,z:(c.y-TH.oc.y)/TH.s};}
function mkGeo(ring,h){var sh=new THREE.Shape();ring.forEach(function(q,i){var p=local(q);i?sh.lineTo(p.x,-p.z):sh.moveTo(p.x,-p.z);});
  var g=new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);return g;}
function neighbors(){if(!TH||!TH.sc||TH.nb)return;var fs;try{fs=m.querySourceFeatures('ofm',{sourceLayer:'building'});}catch(e){return;}
  var seen={},arr=[],mat=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false});   // görünmez ama gölge düşürür (görsel bina MapLibre katmanında)
  fs.forEach(function(f){var g=f.geometry,r=g.type==='Polygon'?g.coordinates[0]:g.type==='MultiPolygon'?g.coordinates[0][0]:null,h=+f.properties.render_height,b=+f.properties.render_min_height||0;
    if(!r||!(h>b))return;var k=r[0][0].toFixed(6)+','+r[0][1].toFixed(6);if(seen[k])return;seen[k]=1;var p=local(r[0]);
    if(Math.abs(p.x)>320||Math.abs(p.z)>320)return;arr.push({r:r,h:h-b,b:b,q:r[0],d:p.x*p.x+p.z*p.z});});
  arr.sort(function(a,c){return a.d-c.d;}).slice(0,300).forEach(function(o){var ms=new THREE.Mesh(mkGeo(o.r,o.h),mat);ms.userData={b:o.b,q:o.q};ms.castShadow=true;TH.sc.add(ms);TH.nbm.push(ms);});
  TH.nb=arr.length;placeNb();TH.dirty=true;m.triggerRepaint();}
function elev(){if(!TH)return;   // taban kotu = parsel köşeleri + merkez kotlarının MİNİMUMU (eğimde köşe havada kalmasın)
  var ce=elevAt(TH.org),mn=ce;TH.ring.forEach(function(q){var e=elevAt(q);if(e!==null&&(mn===null||e<mn))mn=e;});
  if(mn===null)return;   // DEM henüz yüklenmedi: mevcut kot korunur
  var cE=(ce===null?mn:ce),co=cE-mn;
  if(Math.abs(mn-TH.alt)>.25||Math.abs(co-TH.cOff)>.25){TH.alt=mn;TH.cE=cE;TH.cOff=co;TH.oc=maplibregl.MercatorCoordinate.fromLngLat(TH.org,mn);rig();placeNb();m.triggerRepaint();}
  groundFit();}
function startThree(g){if(!g)return;var ring=g.type==='Polygon'?g.coordinates[0]:g.type==='MultiPolygon'?g.coordinates[0][0]:null;if(!ring)return;
  loadThree().then(function(){
    var cx=0,cy=0;ring.forEach(function(q){cx+=q[0];cy+=q[1];});
    TH={ring:ring,org:[cx/ring.length,cy/ring.length],alt:0,cE:0,cOff:0,nbm:[],dirty:true};
    TH.oc=maplibregl.MercatorCoordinate.fromLngLat(TH.org,0);TH.s=TH.oc.meterInMercatorCoordinateUnits();
    m.addLayer({id:'dp3',type:'custom',renderingMode:'3d',
      onAdd:function(map,gl){var T=TH;T.sc=new THREE.Scene();T.cam=new THREE.Camera();
        T.rend=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});T.rend.autoClear=false;T.rend.outputEncoding=THREE.sRGBEncoding;
        T.rend.shadowMap.enabled=true;T.rend.shadowMap.type=THREE.PCFSoftShadowMap;T.rend.shadowMap.autoUpdate=false;   // gölge haritası kameradan bağımsız: yalnızca güneş/kütle/kot değişince yenilenir
       
        T.sun=new THREE.DirectionalLight(0xffffff,2);T.sun.castShadow=true;T.sun.shadow.mapSize.set(2048,2048);
        var c=T.sun.shadow.camera;c.left=-320;c.right=320;c.top=320;c.bottom=-320;c.near=1;c.far=2000;c.updateProjectionMatrix();T.sun.shadow.bias=-.0005;   // updateProjectionMatrix şart: yoksa kamera varsayılan ±5 m / far 500 kalır, ışık 600 m uzakta olduğundan gölge haritası boş çıkar
       T.sc.add(T.sun,T.sun.target);
        T.amb=new THREE.HemisphereLight(0xffffff,0x8A7F6A,.6);T.sc.add(T.amb);
        var gg=new THREE.PlaneGeometry(600,600,60,60);gg.rotateX(-Math.PI/2);   // 10 m ızgara (~3,7 bin köşe); yükseklikler groundFit() ile araziye oturtulur
        T.ground=new THREE.Mesh(gg,new THREE.ShadowMaterial({opacity:.55,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));   // görünmez zemin, yalnızca gölge alır
        T.ground.frustumCulled=false;T.ground.position.y=.35;T.ground.receiveShadow=true;T.sc.add(T.ground);
        T.ready=true;},
      render:function(gl,matrix){var T=TH;if(!T||!T.rend)return;
        var l=new THREE.Matrix4().makeTranslation(T.oc.x,T.oc.y,T.oc.z).scale(new THREE.Vector3(T.s,-T.s,T.s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
        T.cam.projectionMatrix=new THREE.Matrix4().fromArray(matrix).multiply(l);T.rend.resetState();if(T.dirty){T.rend.shadowMap.needsUpdate=true;T.dirty=false;}T.rend.render(T.sc,T.cam);}},'edge');
    applyTime('altin');m.on('idle',elev);m.once('idle',function(){elev();neighbors();});
  }).catch(function(e){say('⚠ Gölge/cephe modu kurulamadı: '+e.message+' (gölge kapalı, çizim gösteriliyor)');});}

/* ── Parçalı MP4 (MediaRecorder) → klasik MP4 ──────────────────────
   Video editörleri parçalı (fMP4) dosyada süre bilgisi bulamayıp yalnızca ilk parçayı (~1 sn) açıyor.
   Örnek verisi aynen taşınır; yalnızca moov (süre + örnek tabloları) yeniden yazılır.
   Herhangi bir uyumsuzlukta null döner → orijinal dosya olduğu gibi teslim edilir. */
function remuxFmp4(blob){
  return blob.arrayBuffer().then(function(ab){
    var u8=new Uint8Array(ab), dv=new DataView(ab), N=u8.length;
    function ty(o){ return String.fromCharCode(u8[o+4],u8[o+5],u8[o+6],u8[o+7]); }
    function kids(s,e){
      var out=[], o=s;
      while(o+8<=e){
        var sz=dv.getUint32(o), hs=8;
        if(sz===1){ sz=Number(dv.getBigUint64(o+8)); hs=16; } else if(sz===0) sz=e-o;
        if(sz<hs||o+sz>e) break;
        out.push({t:ty(o),s:o,e:o+sz,b:o+hs}); o+=sz;
      }
      return out;
    }
    function one(l,t){ for(var i=0;i<l.length;i++) if(l[i].t===t) return l[i]; return null; }
    function many(l,t){ return l.filter(function(x){ return x.t===t; }); }
    function cat(a){ var n=0,i; for(i=0;i<a.length;i++) n+=a[i].length; var o=new Uint8Array(n),p=0; for(i=0;i<a.length;i++){ o.set(a[i],p); p+=a[i].length; } return o; }
    function b32(v){ return new Uint8Array([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255]); }
    function mk(t,c){ var o=new Uint8Array(8+c.length); new DataView(o.buffer).setUint32(0,o.length); o[4]=t.charCodeAt(0); o[5]=t.charCodeAt(1); o[6]=t.charCodeAt(2); o[7]=t.charCodeAt(3); o.set(c,8); return o; }
    function raw(x){ return u8.slice(x.s,x.e); }

    var top=kids(0,N), moov=one(top,'moov');
    if(!moov||!one(top,'moof')) return null;
    var mk0=kids(moov.b,moov.e), traks=many(mk0,'trak'), mvhd=one(mk0,'mvhd');
    if(traks.length!==1||!mvhd) return null;
    var tk=kids(traks[0].b,traks[0].e), tkhd=one(tk,'tkhd'), mdia=one(tk,'mdia');
    if(!tkhd||!mdia) return null;
    var md=kids(mdia.b,mdia.e), mdhd=one(md,'mdhd'), hdlr=one(md,'hdlr'), minf=one(md,'minf');
    if(!mdhd||!hdlr||!minf) return null;
    var mi=kids(minf.b,minf.e), vmhd=one(mi,'vmhd'), dinf=one(mi,'dinf'), stbl=one(mi,'stbl');
    if(!vmhd||!dinf||!stbl) return null;
    var stsd=one(kids(stbl.b,stbl.e),'stsd');
    if(!stsd) return null;
    var trackTS=dv.getUint32(mdhd.b+(u8[mdhd.b]===1?20:12));
    var movieTS=dv.getUint32(mvhd.b+(u8[mvhd.b]===1?20:12));
    var trackId=dv.getUint32(tkhd.b+(u8[tkhd.b]===1?20:12)-4+0) ; // yalnızca bilgi amaçlı
    var trex=null, mvex=one(mk0,'mvex'); if(mvex) trex=one(kids(mvex.b,mvex.e),'trex');
    var dDur=trex?dv.getUint32(trex.b+12):0, dSize=trex?dv.getUint32(trex.b+16):0, dFlg=trex?dv.getUint32(trex.b+20):0;

    var offs=[], sizes=[], durs=[], sync=[], cto=[], anyCto=false, needDur=[];
    for(var i=0;i<top.length;i++){
      if(top[i].t!=='moof') continue;
      var moof=top[i], trafs=many(kids(moof.b,moof.e),'traf');
      for(var ti=0;ti<trafs.length;ti++){
        var tc=kids(trafs[ti].b,trafs[ti].e), tfhd=one(tc,'tfhd'); if(!tfhd) return null;
        var fl=dv.getUint32(tfhd.b)&0xFFFFFF, p=tfhd.b+8, base=moof.s, fDur=dDur, fSize=dSize, fFlg=dFlg;
        if(fl&1){ base=Number(dv.getBigUint64(p)); p+=8; }
        if(fl&2) p+=4;
        if(fl&8){ fDur=dv.getUint32(p); p+=4; }
        if(fl&0x10){ fSize=dv.getUint32(p); p+=4; }
        if(fl&0x20){ fFlg=dv.getUint32(p); p+=4; }
        var tfdt=one(tc,'tfdt'), bmdt=-1;
        if(tfdt) bmdt=(u8[tfdt.b]===1)?Number(dv.getBigUint64(tfdt.b+4)):dv.getUint32(tfdt.b+4);
        var runs=many(tc,'trun'), cur=base, fragStart=durs.length;
        for(var ri=0;ri<runs.length;ri++){
          var r=runs[ri], ver=u8[r.b], rf=dv.getUint32(r.b)&0xFFFFFF, cnt=dv.getUint32(r.b+4), q=r.b+8, first=-1;
          if(rf&1){ cur=base+dv.getInt32(q); q+=4; }
          if(rf&4){ first=dv.getUint32(q); q+=4; }
          for(var s=0;s<cnt;s++){
            var d=fDur, z=fSize, f=fFlg, c=0;
            if(rf&0x100){ d=dv.getUint32(q); q+=4; }
            if(rf&0x200){ z=dv.getUint32(q); q+=4; }
            if(rf&0x400){ f=dv.getUint32(q); q+=4; }
            else if(s===0&&first>=0) f=first;
            if(rf&0x800){ c=ver?dv.getInt32(q):dv.getUint32(q); q+=4; }
            if(!z||cur+z>N) return null;
            offs.push(cur); sizes.push(z); durs.push(d); sync.push(!(f&0x10000)); cto.push(c); if(c) anyCto=true;
            cur+=z;
          }
        }
        // süre bilgisi hiçbir yerde yoksa: parça süresini (sonraki tfdt farkı) örneklere eşit dağıt
        if(fragStart<durs.length&&!durs[fragStart]){ needDur.push({a:fragStart,b:durs.length,t:bmdt}); }
      }
    }
    var n=offs.length; if(!n) return null;
    if(needDur.length){
      for(var k=0;k<needDur.length;k++){
        var g=needDur[k], nx=needDur[k+1], span=(nx&&nx.t>=0&&g.t>=0)?(nx.t-g.t):0, cntg=g.b-g.a;
        var each=span>0?Math.max(1,Math.round(span/cntg)):Math.round(trackTS/30);
        for(var m=g.a;m<g.b;m++) durs[m]=each;
      }
    }
    var total=0, dataLen=0, j;
    for(j=0;j<n;j++){ total+=durs[j]; dataLen+=sizes[j]; }
    if(!total||dataLen+8>0xFFFFFFFF) return null;

    // stts (aynı süreler tek satırda)
    var sttsRows=[], runDur=durs[0], runCnt=0;
    for(j=0;j<n;j++){ if(durs[j]===runDur) runCnt++; else { sttsRows.push(b32(runCnt),b32(runDur)); runDur=durs[j]; runCnt=1; } }
    sttsRows.push(b32(runCnt),b32(runDur));
    var stts=mk('stts',cat([b32(0),b32(sttsRows.length/2)].concat(sttsRows)));
    var stss=null, sy=[];
    for(j=0;j<n;j++) if(sync[j]) sy.push(b32(j+1));
    if(sy.length&&sy.length<n) stss=mk('stss',cat([b32(0),b32(sy.length)].concat(sy)));
    var ctts=null;
    if(anyCto){
      var cr=[], cd=cto[0], cc=0;
      for(j=0;j<n;j++){ if(cto[j]===cd) cc++; else { cr.push(b32(cc),b32(cd>>>0)); cd=cto[j]; cc=1; } }
      cr.push(b32(cc),b32(cd>>>0));
      ctts=mk('ctts',cat([new Uint8Array([1,0,0,0]),b32(cr.length/2)].concat(cr)));
    }
    var stsc=mk('stsc',cat([b32(0),b32(1),b32(1),b32(n),b32(1)]));
    var szs=[b32(0),b32(0),b32(n)]; for(j=0;j<n;j++) szs.push(b32(sizes[j]));
    var stsz=mk('stsz',cat(szs));
    function build(stcoOff){
      var stco=mk('stco',cat([b32(0),b32(1),b32(stcoOff)]));
      var stblN=mk('stbl',cat([raw(stsd),stts].concat(stss?[stss]:[],ctts?[ctts]:[],[stsc,stsz,stco])));
      var minfN=mk('minf',cat([raw(vmhd),raw(dinf),stblN]));
      var mdhdN=raw(mdhd), mv=new DataView(mdhdN.buffer);
      if(mdhdN[8]===1) mv.setBigUint64(8+24,BigInt(total)); else mv.setUint32(8+16,total);
      var mdiaN=mk('mdia',cat([mdhdN,raw(hdlr),minfN]));
      var movDur=Math.round(total/trackTS*movieTS);
      var tkhdN=raw(tkhd), tv=new DataView(tkhdN.buffer);
      if(tkhdN[8]===1) tv.setBigUint64(8+28,BigInt(movDur)); else tv.setUint32(8+20,movDur);
      var trakN=mk('trak',cat([tkhdN,mdiaN]));
      var mvhdN=raw(mvhd), hv=new DataView(mvhdN.buffer);
      if(mvhdN[8]===1) hv.setBigUint64(8+24,BigInt(movDur)); else hv.setUint32(8+16,movDur);
      return mk('moov',cat([mvhdN,trakN]));
    }
    var ftypN=mk('ftyp',cat([new Uint8Array([105,115,111,109]),b32(512),new Uint8Array([105,115,111,109,105,115,111,50,97,118,99,49,109,112,52,49])]));
    var moovLen=build(0).length, moovN=build(ftypN.length+moovLen+8);
    var parts=[ftypN,moovN,b32(dataLen+8),new Uint8Array([109,100,97,116])];
    var rs=offs[0], re=offs[0]+sizes[0];
    for(j=1;j<n;j++){
      if(offs[j]===re) re+=sizes[j];
      else { parts.push(u8.subarray(rs,re)); rs=offs[j]; re=offs[j]+sizes[j]; }
    }
    parts.push(u8.subarray(rs,re));
    return new Blob(parts,{type:'video/mp4'});
  });
}

function stopRec(){if(rec&&rec.state!=='inactive')rec.stop();}
function fit(R){var d=$('d3Map'),w=innerWidth,h=w/R;if(h>innerHeight){h=innerHeight;w=h*R;}
  d.style.cssText='position:absolute;left:50%;top:50%;width:'+w+'px;height:'+h+'px;transform:translate(-50%,-50%)';
  m.resize();try{m.setPixelRatio(Math.min(3,Math.max(devicePixelRatio||1,1920/Math.max(w,h))));m.resize();}catch(e){}}
function unfit(){var d=$('d3Map');if(d)d.style.cssText='';if(m){try{m.setPadding({top:0,left:0,right:0,bottom:0});}catch(e){}try{m.setPixelRatio(devicePixelRatio||1);}catch(e){}m.resize();}}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
/* Kayıt karesi: harita + Ada/Parsel bandı + atıf (DOM arayüzü videoya girmez, bunlar tuvale çizilir) */
function compose(){var W=outC.width,H=outC.height,c=octx,s=Math.min(W,H)/1080;
  c.drawImage(m.getCanvas(),0,0,W,H);
  var p=window.DP&&DP.cur&&DP.cur();
  if(p){var al=p.alan?Math.round(+p.alan):(window.turf?Math.round(turf.area(p.feature)):0),
      l1='Ada '+(p.ada||'—')+' / Parsel '+(p.parsel||'—'),
      l2=[al?al.toLocaleString('tr-TR')+' m²':'',p.nitelik,p.il||p.ilce].filter(Boolean).join(' · '),
      bw=W-80*s,bh=(l2?150:100)*s,bx=40*s,by=H-bh-70*s;
    c.fillStyle='rgba(10,21,32,.72)';rr(c,bx,by,bw,bh,28*s);c.fill();
    c.fillStyle='#fff';c.textAlign='left';c.textBaseline='alphabetic';c.font='700 '+Math.round(52*s)+"px 'Inter',Arial,sans-serif";c.fillText(l1,bx+32*s,by+(l2?66:64)*s);
    if(l2){c.fillStyle='#FBBF24';c.font='600 '+Math.round(36*s)+"px 'Inter',Arial,sans-serif";c.fillText(l2,bx+32*s,by+116*s);}}
  c.fillStyle='rgba(255,255,255,.85)';c.textAlign='center';c.font='500 '+Math.round(22*s)+"px 'Inter',Arial,sans-serif";
  c.fillText('© Esri · © OpenFreeMap / OpenMapTiles · © OpenStreetMap',W/2,H-24*s);
  if(cine){c.fillStyle='#FBBF24';c.fillRect(0,0,W*Math.min(1,(performance.now()-cine.t0)/20000),6*s);}}
function open3d(){var p=window.DP&&DP.cur();if(!p){ntf('⚠ Parsel yükleyin','err');return;}
  if($('dp3d'))return;ui();say('3B harita yükleniyor…');
  load().then(function(){
    var ip=imar(p);
    function geo(x){if(x.id===p.id&&ip.taks&&ip.taks<1){try{return turf.transformScale(x.feature,Math.sqrt(ip.taks),{origin:'centroid'}).geometry;}catch(e){}}return x.feature.geometry;}
    var fc={type:'FeatureCollection',features:window.parcels.map(function(x){return {type:'Feature',properties:{sel:x.id===p.id?1:0},geometry:geo(x)};})};
    var c=turf.center(p.feature).geometry.coordinates;
    m=new maplibregl.Map({container:'d3Map',center:c,zoom:17,pitch:60,bearing:20,maxPitch:85,
      style:{version:8,sources:{sat:{type:'raster',tiles:[CFG.sat],tileSize:256,maxzoom:19,attribution:'Esri'},
        dem:{type:'raster-dem',tiles:[CFG.dem],encoding:'terrarium',tileSize:256,maxzoom:14}},
        layers:[{id:'sat',type:'raster',source:'sat'}],terrain:{source:'dem',exaggeration:CFG.exag}},
      preserveDrawingBuffer:true,canvasContextAttributes:{preserveDrawingBuffer:true}});
    m.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
    var errN=0;m.on('error',function(e){if(e&&e.sourceId==='ofm'&&++ofmErr===3){bkp();return;}if(++errN===3)say('⚠ Bazı harita/arazi karoları yüklenemedi: '+((e.error&&e.error.message)||'ağ hatası'));});
    m.on('load',function(){say('');
      m.addSource('parcels',{type:'geojson',data:fc});
      m.addSource('ofm',{type:'vector',url:CFG.ofm,attribution:CFG.ofmAttr});
      m.addLayer({id:'mass',type:'fill',source:'parcels',paint:{'fill-color':['case',['==',['get','sel'],1],'#F59E0B','#10B981'],'fill-opacity':['case',['==',['get','sel'],1],.55,.4]}});   // düz iç boyama (yükseklik yok; arazi üzerine oturur)
      m.addLayer({id:'bldg',type:'fill-extrusion',source:'ofm','source-layer':'building',minzoom:14,filter:['!=',['get','hide_3d'],true],
        paint:{'fill-extrusion-color':'#E5E7EB','fill-extrusion-opacity':.85,
          'fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0]}});
      m.addLayer({id:'edge',type:'line',source:'parcels',paint:{'line-color':['case',['==',['get','sel'],1],'#FFFFFF','#A7F3D0'],'line-width':['case',['==',['get','sel'],1],4,2]}});
      raf=requestAnimationFrame(frame);
      startThree((fc.features.find(function(f){return f.properties.sel===1;})||{}).geometry);
      say(ip.taks&&ip.taks<1?'Dosyadaki TAKS '+ip.taks+' → çizim parsel sınırından küçültüldü (taban alanı gösterimi).':'');});
    m.on('dragstart',function(){orbit=false;var b=$('d3O');if(b)b.textContent='⟳ Orbit: kapalı';});
  },function(e){say('⚠ '+e.message);});}
function close3d(){if(rec&&rec.state!=='inactive')rec.stop();cancelAnimationFrame(raf);try{if(m)m.remove();}catch(e){}m=null;var d=$('dp3d');if(d)d.remove();TH=null;}
window.DP3D={open:open3d,close:close3d,
  pitch:function(v){if(m)m.setPitch(+v);},
  bld:function(){if(!m||!m.getLayer('bldg'))return;var on=m.getLayoutProperty('bldg','visibility')==='none';
    m.setLayoutProperty('bldg','visibility',on?'visible':'none');$('d3B').textContent='🏢 Binalar: '+(on?'açık':'kapalı');},
  key:function(){var k=prompt('MapTiler API anahtarı (yalnızca bu cihazda saklanır; sitenizle sınırlandırın):');
    if(!k)return;try{localStorage.setItem('dpmt',k.trim());}catch(e){}say('Anahtar kaydedildi');if(m&&!m.getLayer('bldg'))bkp();},
  toggleOrbit:function(){orbit=!orbit;$('d3O').textContent='⟳ Orbit: '+(orbit?'açık':'kapalı');},
  time:function(k){applyTime(k);},
  dbg:function(){if(!TH||!TH.ground){say('3B henüz hazır değil');return;}   // 8 sn: zemini güneşten aydınlanan açık gri yüzey yap (gölge varsa koyu leke olarak görünür) + durum satırı
    var g=TH.ground,old=g.material,dm=new THREE.MeshLambertMaterial({color:0xe8e8e8,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),
      sp=sunPos(when(TH.key||'altin'),TH.org[1],TH.org[0]);g.material=dm;m.triggerRepaint();
    say('Test · taban kot '+TH.alt.toFixed(1)+' m · merkez farkı '+TH.cOff.toFixed(1)+' m · güneş az '+Math.round(sp.az)+'° yük '+Math.round(sp.el)+'° · gölge '+(g.visible&&TH.sun.castShadow?'açık':'kapalı')+' · komşu '+(TH.nb||0)+' · sürüm 5 · gölge far '+TH.sun.shadow.camera.far+' · harita '+(TH.sun.shadow.map?'var':'yok'));
    TH.dirty=true;setTimeout(function(){g.material=old;dm.dispose();m.triggerRepaint();},8000);},
  shadow:function(){if(!TH||!TH.ground)return;var on=!TH.ground.visible;TH.ground.visible=on;TH.sun.castShadow=on;TH.dirty=true;$('d3S').textContent='Gölge: '+(on?'açık':'kapalı');m.triggerRepaint();},
  cine:function(){DP3D.rec('cine');},
  rec:function(mode){var b=$('d3R');if(!m)return;
    if(rec&&rec.state==='recording'){stopRec();return;}
    if(!window.MediaRecorder){say('⚠ Bu tarayıcı kayıt desteklemiyor');return;}
    var f=$('d3F').value,L=f==='16:9',W=L?1920:1080,H=L?1080:1920;
    fit(L?16/9:9/16);try{m.setPadding({top:0,left:0,right:0,bottom:Math.round(m.getContainer().clientHeight*0.2)});}catch(e){}   // parsel bilgi bandının üstünde ortalanır
outC=document.createElement('canvas');outC.width=W;outC.height=H;octx=outC.getContext('2d');
    var mt=['video/mp4;codecs=avc1','video/webm;codecs=vp9','video/webm'].find(function(t){return MediaRecorder.isTypeSupported(t);});
    try{rec=new MediaRecorder(outC.captureStream(30),{mimeType:mt,videoBitsPerSecond:10e6});}catch(e){unfit();outC=null;say('⚠ Kayıt başlatılamadı: '+e.message);return;}
    chunks=[];rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
    rec.onstop=function(){outC=null;cine=null;orbit=true;var ob=$('d3O');if(ob)ob.textContent='⟳ Orbit: açık';var bb=$('d3R'),cc=$('d3C');if(bb)bb.textContent='● Serbest kayıt';if(cc)cc.disabled=false;
      var ext=/mp4/.test(mt)?'mp4':'webm',a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:mt}));
      a.download='3d-parsel-'+(L?'16x9':'9x16')+'-'+Date.now()+'.'+ext;document.body.appendChild(a);a.click();a.remove();unfit();say('✓ Kayıt indirildi ('+W+'×'+H+')');};
    /* MediaRecorder MP4'ü parçalıdır (süre bilgisi yok) → video editörleri yalnızca ilk ~1 sn'yi açar.
       Kayıt bitince örnekler aynen korunarak klasik MP4'e çevrilir; olmazsa orijinal dosya indirilir. */
    var _os=rec.onstop;
    rec.onstop=function(){
      if(/mp4/.test(mt)){
        remuxFmp4(new Blob(chunks,{type:mt})).then(function(nb){ if(nb) chunks=[nb]; _os(); }).catch(function(e){ console.warn('remux',e); _os(); });
      } else _os();
    };
    if(mode==='cine'){cine={t0:performance.now(),c:m.getCenter(),b0:m.getBearing()};orbit=false;$('d3C').disabled=true;}
    rec.start(500);b.textContent='■ Durdur';say(mode==='cine'?'Sinematik kayıt 20 sn sürer…':'Kayıt sürüyor');}};
var bar=document.querySelector('button.bb[onclick^="showExport"]');
if(bar){var n=document.createElement('button');n.className='bb';n.setAttribute('onclick','DP3D.open()');n.innerHTML='<span class="bb-ico">🏔</span><span class="bb-lbl">3B</span>';bar.parentNode.insertBefore(n,bar);}
})();
