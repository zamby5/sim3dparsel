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
var outC=null,octx=null,cine=null,lastT=0,ofmErr=0,lib=null,m=null,raf=0,orbit=true,rec=null,chunks=[];
function $(i){return document.getElementById(i);}
function load(){if(lib)return lib;lib=new Promise(function(ok,no){
  var l=document.createElement('link');l.rel='stylesheet';l.href='https://cdn.jsdelivr.net/npm/maplibre-gl@'+V+'/dist/maplibre-gl.css';document.head.appendChild(l);
  var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/maplibre-gl@'+V+'/dist/maplibre-gl.js';
  s.onload=ok;s.onerror=function(){lib=null;no(new Error('MapLibre yüklenemedi (CDN/ağ). Bağlantıyı kontrol edin.'));};document.head.appendChild(s);});return lib;}
function nk(k){return String(k).toUpperCase().replace(/İ/g,'I').replace(/[^A-Z0-9]/g,'');}
function num(v){var n=parseFloat(String(v).replace(',','.'));return isFinite(n)&&n>0?n:null;}
/* GeoJSON/KML özelliklerinden imar parametreleri (alan adları dosyada varsa). Kat yüksekliği 3 m VARSAYIMDIR. */
function imar(p){var pr=(p.feature&&p.feature.properties)||{},o={};
  Object.keys(pr).forEach(function(k){var K=nk(k),v=num(pr[k]);if(v==null)return;
    if(/^(TAKS|TABANALANKATSAYISI)$/.test(K))o.taks=v;
    else if(/^(KAKS|EMSAL|EMSALORANI)$/.test(K))o.kaks=v;
    else if(/^(KAT|KATADEDI|KATADET|KATSAYISI|MAXKAT)$/.test(K))o.kat=v;
    else if(/^(HMAX|YUKSEKLIK|YAPIYUKSEKLIGI|MAXYUKSEKLIK)$/.test(K))o.hmax=v;});
  if(o.taks>1)o.taks=o.taks/100;
  o.h=o.hmax||(o.kat?o.kat*3:(o.kaks&&o.taks?Math.ceil(o.kaks/o.taks)*3:null));return o;}
function mtKey(){try{return localStorage.getItem('dpmt')||'';}catch(e){return '';}}
function bkp(){var k=mtKey();
  if(!k){say('⚠ OpenFreeMap bina verisi alınamadı. Yedek için 🔑 ile MapTiler anahtarı girin.');return;}
  try{if(m.getLayer('bldg'))m.removeLayer('bldg');if(m.getSource('ofm'))m.removeSource('ofm');
    m.addSource('mt',{type:'vector',url:'https://api.maptiler.com/tiles/v3/tiles.json?key='+encodeURIComponent(k),attribution:'© MapTiler © OpenStreetMap contributors'});
    m.addLayer({id:'bldg',type:'fill-extrusion',source:'mt','source-layer':'building',minzoom:14,filter:['!=',['get','hide_3d'],true],
      paint:{'fill-extrusion-color':'#E5E7EB','fill-extrusion-opacity':.85,'fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0]}},'mass');
    say('Yedek bina kaynağı: MapTiler');}catch(e){say('⚠ MapTiler yedeği kurulamadı: '+e.message);}}
function say(t){var e=$('d3Msg');if(e)e.textContent=t||'';}
function ui(){var d=document.createElement('div');d.id='dp3d';
  d.innerHTML='<div id="d3Map"></div><div id="d3Bar"><button class="d3b" onclick="DP3D.close()">✕ Kapat</button>'+
  '<label>Eğim <input type="range" min="0" max="80" value="60" oninput="DP3D.pitch(this.value)"></label>'+
  '<label>Kütle yüksekliği <input id="d3Hs" type="range" min="0" max="60" value="12" oninput="DP3D.h(this.value)"><b id="d3H">12 m</b></label>'+
  '<button class="d3b" onclick="DP3D.key()">🔑 MapTiler</button><button class="d3b" id="d3B" onclick="DP3D.bld()">🏢 Binalar: açık</button><button class="d3b" id="d3O" onclick="DP3D.toggleOrbit()">⟳ Orbit: açık</button><select class="d3b" id="d3F"><option value="9:16">9:16 dikey</option><option value="16:9">16:9 yatay</option></select><button class="d3b" id="d3C" onclick="DP3D.cine()">🎬 Sinematik 20 sn</button><button class="d3b" id="d3R" onclick="DP3D.rec()">● Serbest kayıt</button><span id="d3Msg"></span></div>';
  document.body.appendChild(d);}
function ease(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;}
function frame(ts){raf=requestAnimationFrame(frame);var dt=lastT?Math.min(.1,(ts-lastT)/1000):0;lastT=ts;if(!m)return;
  if(cine)cineStep();else if(orbit)m.setBearing((m.getBearing()+12*dt)%360);   // serbest orbit ~12°/sn
  if(outC)compose();}
/* Sinematik yol (20 sn): uzaktan yakına, eğim artar, 270° dönüş */
function cineStep(){var t=(performance.now()-cine.t0)/1000;if(t>=20){stopRec();return;}
  var a=ease(Math.min(1,t/12)),v=Math.max(0,Math.min(1,(t-12)/8));
  m.jumpTo({center:cine.c,zoom:15.2+2*a+0.6*v,pitch:30+32*a+6*v,bearing:cine.b0+200*a+70*v});}
function stopRec(){if(rec&&rec.state!=='inactive')rec.stop();}
function fit(R){var d=$('d3Map'),w=innerWidth,h=w/R;if(h>innerHeight){h=innerHeight;w=h*R;}
  d.style.cssText='position:absolute;left:50%;top:50%;width:'+w+'px;height:'+h+'px;transform:translate(-50%,-50%)';
  m.resize();try{m.setPixelRatio(Math.min(3,Math.max(devicePixelRatio||1,1920/Math.max(w,h))));m.resize();}catch(e){}}
function unfit(){var d=$('d3Map');if(d)d.style.cssText='';if(m){try{m.setPixelRatio(devicePixelRatio||1);}catch(e){}m.resize();}}
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
      m.addLayer({id:'bldg',type:'fill-extrusion',source:'ofm','source-layer':'building',minzoom:14,filter:['!=',['get','hide_3d'],true],
        paint:{'fill-extrusion-color':'#E5E7EB','fill-extrusion-opacity':.85,
          'fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0]}});
      m.addLayer({id:'mass',type:'fill-extrusion',source:'parcels',paint:{'fill-extrusion-color':['case',['==',['get','sel'],1],'#F59E0B','#10B981'],'fill-extrusion-height':12,'fill-extrusion-opacity':.75}});
      m.addLayer({id:'edge',type:'line',source:'parcels',paint:{'line-color':'#fff','line-width':2}});
      raf=requestAnimationFrame(frame);
      if(ip.h){var hh=Math.min(60,Math.round(ip.h));m.setPaintProperty('mass','fill-extrusion-height',hh);$('d3Hs').value=hh;$('d3H').textContent=hh+' m';
        say('İmar (dosyadan): '+[ip.taks&&'TAKS '+ip.taks,ip.kaks&&'KAKS '+ip.kaks,ip.kat&&ip.kat+' kat',ip.hmax&&'Hmax '+ip.hmax+' m'].filter(Boolean).join(' · ')+' → ~'+hh+' m (kat=3 m varsayımı'+(ip.taks&&ip.taks<1?'; taban TAKS oranında küçültüldü':'')+')');}
      else say('Dosyada TAKS/KAKS/kat alanı yok; yükseklik elle ayarlanır.');});
    m.on('dragstart',function(){orbit=false;var b=$('d3O');if(b)b.textContent='⟳ Orbit: kapalı';});
  },function(e){say('⚠ '+e.message);});}
function close3d(){if(rec&&rec.state!=='inactive')rec.stop();cancelAnimationFrame(raf);try{if(m)m.remove();}catch(e){}m=null;var d=$('dp3d');if(d)d.remove();}
window.DP3D={open:open3d,close:close3d,
  pitch:function(v){if(m)m.setPitch(+v);},
  h:function(v){if(m&&m.getLayer('mass'))m.setPaintProperty('mass','fill-extrusion-height',+v);$('d3H').textContent=v+' m';},
  bld:function(){if(!m||!m.getLayer('bldg'))return;var on=m.getLayoutProperty('bldg','visibility')==='none';
    m.setLayoutProperty('bldg','visibility',on?'visible':'none');$('d3B').textContent='🏢 Binalar: '+(on?'açık':'kapalı');},
  key:function(){var k=prompt('MapTiler API anahtarı (yalnızca bu cihazda saklanır; sitenizle sınırlandırın):');
    if(!k)return;try{localStorage.setItem('dpmt',k.trim());}catch(e){}say('Anahtar kaydedildi');if(m&&!m.getLayer('bldg'))bkp();},
  toggleOrbit:function(){orbit=!orbit;$('d3O').textContent='⟳ Orbit: '+(orbit?'açık':'kapalı');},
  cine:function(){DP3D.rec('cine');},
  rec:function(mode){var b=$('d3R');if(!m)return;
    if(rec&&rec.state==='recording'){stopRec();return;}
    if(!window.MediaRecorder){say('⚠ Bu tarayıcı kayıt desteklemiyor');return;}
    var f=$('d3F').value,L=f==='16:9',W=L?1920:1080,H=L?1080:1920;
    fit(L?16/9:9/16);outC=document.createElement('canvas');outC.width=W;outC.height=H;octx=outC.getContext('2d');
    var mt=['video/mp4;codecs=avc1','video/webm;codecs=vp9','video/webm'].find(function(t){return MediaRecorder.isTypeSupported(t);});
    try{rec=new MediaRecorder(outC.captureStream(30),{mimeType:mt,videoBitsPerSecond:10e6});}catch(e){unfit();outC=null;say('⚠ Kayıt başlatılamadı: '+e.message);return;}
    chunks=[];rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
    rec.onstop=function(){outC=null;cine=null;orbit=true;var bb=$('d3R'),cc=$('d3C');if(bb)bb.textContent='● Serbest kayıt';if(cc)cc.disabled=false;
      var ext=/mp4/.test(mt)?'mp4':'webm',a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:mt}));
      a.download='3d-parsel-'+(L?'16x9':'9x16')+'-'+Date.now()+'.'+ext;document.body.appendChild(a);a.click();a.remove();unfit();say('✓ Kayıt indirildi ('+W+'×'+H+')');};
    if(mode==='cine'){cine={t0:performance.now(),c:m.getCenter(),b0:m.getBearing()};orbit=false;$('d3C').disabled=true;}
    rec.start(500);b.textContent='■ Durdur';say(mode==='cine'?'Sinematik kayıt 20 sn sürer…':'Kayıt sürüyor');}};
var bar=document.querySelector('button.bb[onclick^="showExport"]');
if(bar){var n=document.createElement('button');n.className='bb';n.setAttribute('onclick','DP3D.open()');n.innerHTML='<span class="bb-ico">🏔</span><span class="bb-lbl">3B</span>';bar.parentNode.insertBefore(n,bar);}
})();
