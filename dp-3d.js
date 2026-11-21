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
var ofmErr=0,lib=null,m=null,raf=0,orbit=true,rec=null,chunks=[];
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
  '<button class="d3b" onclick="DP3D.key()">🔑 MapTiler</button><button class="d3b" id="d3B" onclick="DP3D.bld()">🏢 Binalar: açık</button><button class="d3b" id="d3O" onclick="DP3D.toggleOrbit()">⟳ Orbit: açık</button><button class="d3b" id="d3R" onclick="DP3D.rec()">● Kayıt</button><span id="d3Msg"></span></div>';
  document.body.appendChild(d);}
function frame(){if(m&&orbit)m.setBearing((m.getBearing()+0.12)%360);raf=requestAnimationFrame(frame);}
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
  rec:function(){var b=$('d3R');if(!m)return;
    if(rec&&rec.state==='recording'){rec.stop();return;}
    if(!window.MediaRecorder){say('⚠ Bu tarayıcı kayıt desteklemiyor');return;}
    var mt=['video/mp4;codecs=avc1','video/webm;codecs=vp9','video/webm'].find(function(t){return MediaRecorder.isTypeSupported(t);});
    try{rec=new MediaRecorder(m.getCanvas().captureStream(30),{mimeType:mt,videoBitsPerSecond:8e6});}catch(e){say('⚠ Kayıt başlatılamadı: '+e.message);return;}
    chunks=[];rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
    rec.onstop=function(){b.textContent='● Kayıt';var ext=/mp4/.test(mt)?'mp4':'webm',a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob(chunks,{type:mt}));a.download='3d-parsel-'+Date.now()+'.'+ext;document.body.appendChild(a);a.click();a.remove();say('✓ Kayıt indirildi');};
    rec.start(500);b.textContent='■ Durdur';say('Kayıt sürüyor (arayüz videoya girmez)');}};
var bar=document.querySelector('button.bb[onclick^="showExport"]');
if(bar){var n=document.createElement('button');n.className='bb';n.setAttribute('onclick','DP3D.open()');n.innerHTML='<span class="bb-ico">🏔</span><span class="bb-lbl">3B</span>';bar.parentNode.insertBefore(n,bar);}
})();
