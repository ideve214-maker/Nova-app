/* 每日天气帖：首页动态流顶部的客户端卡片，不是数据库里的帖子。
   按本地日期每天第一次打开显示，写在 localStorage；本次会话内保持，下次启动同一天不再出现。
   手动选择的城市优先于 IP 定位。点「用我的位置」才申请定位权限。 */
const WX_PLACE_KEY='nova_weather_place';
const WX_SHOWN_KEY='nova_weather_shown_on';

function wxToday(){
  const d=new Date();
  const z=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());
}
function wxReadShown(){try{return localStorage.getItem(WX_SHOWN_KEY)||''}catch(e){return ''}}
function wxMarkShown(){try{localStorage.setItem(WX_SHOWN_KEY,wxToday())}catch(e){}}
function wxReadPlace(){
  try{
    const raw=localStorage.getItem(WX_PLACE_KEY);
    if(!raw)return null;
    const p=JSON.parse(raw);
    if(p&&((p.lat!=null&&p.lon!=null)||p.id))return p;
  }catch(e){}
  return null;
}
function wxSavePlace(p){
  const st=weatherState();
  st.place=p||null;
  st.saved=!!p;
  try{if(p)localStorage.setItem(WX_PLACE_KEY,JSON.stringify(p));else localStorage.removeItem(WX_PLACE_KEY)}catch(e){}
}

function weatherState(){
  if(!S.wx)S.wx={probed:false,configured:null,loading:false,err:'',data:null,cities:null,q:'',place:wxReadPlace(),saved:!!wxReadPlace(),dismissed:false,keepInFeed:false,geoSt:'',geoMsg:''};
  return S.wx;
}

function wxIcon(code,cls){
  const c=String(code||'').replace(/\D/g,'')||'999';
  const svg=(typeof WX_ICONS==='object'&&(WX_ICONS[c]||WX_ICONS['999']))||'';
  return `<span class="${cls||'wx-ico'}" aria-hidden="true">${svg}</span>`;
}

function wxDateLabel(s){
  const d=String(s||'').slice(0,10);
  if(!d)return '';
  const dt=new Date(d+'T00:00:00');
  if(Number.isNaN(+dt))return d;
  const today=new Date();today.setHours(0,0,0,0);
  const diff=Math.round((dt-today)/86400000);
  if(diff===0)return '今天';
  if(diff===1)return '明天';
  if(diff===2)return '后天';
  return (dt.getMonth()+1)+'/'+dt.getDate();
}

function shouldShowWeatherFeed(){
  const st=weatherState();
  if(st.dismissed)return false;
  if(st.configured===false)return false;
  if(st.keepInFeed)return true;
  if(wxReadShown()===wxToday())return false;
  return true;
}

async function apiWeather(params){
  const q=new URLSearchParams();
  Object.entries(params||{}).forEach(([k,v])=>{if(v!=null&&String(v)!=='')q.set(k,v)});
  const r=await api('GET','/api/weather'+(q.toString()?'?'+q:''));
  if(!r||r.s===0)throw new Error((r&&r.j&&r.j.error&&r.j.error.message)||'暂时无法获取天气，请检查网络后再试。');
  if(r.s===401)throw new Error('请先登录');
  if(r.s!==200)throw new Error((r.j&&r.j.error&&r.j.error.message)||'暂时无法获取天气，请检查网络后再试。');
  return r.j;
}

function locParams(place){
  if(!place)return {};
  const loc=(place.lat!=null&&place.lon!=null)?(place.lat+','+place.lon):(place.id||'');
  return {loc,name:place.name||'',id:place.id||'',adm1:place.adm1||'',adm2:place.adm2||'',country:place.country||''};
}

function loadWeather(){
  const st=weatherState();
  st.loading=true;st.err='';
  st._tok=(st._tok||0)+1;const token=st._tok;
  const place=st.saved?st.place:null;
  return apiWeather(place?locParams(place):{}).then(r=>{
    if(token!==st._tok)return;
    st.loading=false;
    st.probed=true;
    if(r&&r.configured===false){st.configured=false;st.keepInFeed=false;if(typeof render==='function')render(true);return r}
    st.configured=true;
    if(shouldShowWeatherFeed()||st.keepInFeed){st.keepInFeed=true;wxMarkShown()}
    st.data=r;
    if(r&&r.place&&r.place.name)st.place={...(st.place||{}),...r.place};
    if(typeof render==='function')render(true);
    return r;
  }).catch(e=>{
    if(token!==st._tok)return;
    st.loading=false;
    st.probed=true;
    st.err=(e&&e.message)||'暂时无法获取天气，请检查网络后再试。';
    if(st.configured!==false&&(shouldShowWeatherFeed()||st.keepInFeed)){st.configured=true;st.keepInFeed=true;wxMarkShown()}
    if(typeof render==='function')render(true);
  });
}

function probeWeatherFeed(){
  const st=weatherState();
  if(st._probing)return st._probing;
  if(st.probed&&st.data)return Promise.resolve();
  st._probing=loadWeather().finally(()=>{st._probing=null});
  return st._probing;
}


function wxUpdateLabel(obsTime){
  if(!obsTime)return '刚刚';
  const n=typeof obsTime==='number'?obsTime:(typeof obsTime==='string'&&/^\d+$/.test(obsTime)?Number(obsTime):Date.parse(obsTime));
  if(!Number.isFinite(n))return '刚刚';
  const dt=new Date(n), now=new Date();
  const diff=now-dt;
  if(diff>=0&&diff<60*1000)return '刚刚';
  const z=x=>String(x).padStart(2,'0');
  const hm=z(dt.getHours())+':'+z(dt.getMinutes());
  const same=dt.getFullYear()===now.getFullYear()&&dt.getMonth()===now.getMonth()&&dt.getDate()===now.getDate();
  if(same)return '更新于 '+hm;
  return '更新于 '+(dt.getMonth()+1)+'/'+dt.getDate()+' '+hm;
}

function weatherFeedCard(){
  if(typeof usingNet==='function'&&!usingNet())return '';
  if(!shouldShowWeatherFeed())return '';
  const st=weatherState();
  if(!st.probed&&!st._probing)probeWeatherFeed();
  if(st.configured===false)return '';
  if(!st.probed&&!st.data)return '';
  if(!st.keepInFeed)return '';
  const d=st.data&&st.data.now||{};
  const place=st.place||(st.data&&st.data.place)||{};
  const city=place.name||'';
  const daily=(st.data&&st.data.daily)||[];
  const today=daily[0];
  const attr=(st.data&&st.data.attribution)||{text:'天气服务由和风天气提供',url:'https://www.qweather.com'};
  let body='';
  if(st.loading&&!st.data)body='正在获取今天的天气…';
  else if(st.err&&!st.data)body=st.err;
  else{
    const bits=[];
    if(city)bits.push(city);
    if(Number.isFinite(d.temp))bits.push(d.temp+'°');
    if(d.text)bits.push(d.text);
    body=bits.join('  ')||'正在获取今天的天气…';
    if(today&&(Number.isFinite(today.tempMin)||Number.isFinite(today.tempMax))){
      body+='\n今天 '+(Number.isFinite(today.tempMin)?today.tempMin+'°':'')+' / '+(Number.isFinite(today.tempMax)?today.tempMax+'°':'')+(today.text?' '+today.text:'');
    }
  }
  const tm=wxUpdateLabel(d.obsTime);
  return `<article class="fcard wx-fcard" data-wx="1"><div class="fhd"><div class="wx-av" data-a="weather">${wxIcon(d.icon||'100')}</div><div class="gr" data-a="weather"><b class="fn nmb">今日天气</b><small>${esc(tm)}${city?' · '+esc(city):''}</small></div><button type="button" class="ib wx-x" data-a="wxdismiss" aria-label="关闭">✕</button></div><div class="fbd" data-a="weather">${esc(body)}</div><div class="wx-foot"><p class="wx-attr"><a href="${esc(attr.url||'https://www.qweather.com')}" target="_blank" rel="noopener">${esc(attr.text||'天气服务由和风天气提供')}</a></p><button type="button" class="wx-geo" data-a="wxgeo">${st.geoSt==='busy'?'正在定位…':'用我的位置'}</button></div>${st.geoMsg?`<p class="wx-err">${esc(st.geoMsg)}</p>`:''}</article>`;
}

function scheduleWxSearch(){
  const st=weatherState();
  clearTimeout(st._tm);
  st._tm=setTimeout(()=>loadWxCities(st.q),280);
}

function loadWxCities(q){
  const st=weatherState();
  const query=String(q||'').trim();
  st._ctok=(st._ctok||0)+1;const token=st._ctok;
  if(!query){st.cities=null;st.cerr='';st.cloading=false;if(typeof render==='function')render(true);return Promise.resolve()}
  st.cloading=true;
  return apiWeather({q:query}).then(r=>{
    if(token!==st._ctok)return;
    st.cloading=false;st.cerr='';st.cities=(r&&r.cities)||[];
    if(typeof render==='function')render(true);
  }).catch(e=>{
    if(token!==st._ctok)return;
    st.cloading=false;st.cerr=(e&&e.message)||'暂时无法搜索城市，请检查网络后再试。';
    if(typeof render==='function')render(true);
  });
}

function pWeather(){
  const st=weatherState();
  if(st.configured!==false&&!st.data&&!st.loading)loadWeather();
  const d=(st.data&&st.data.now)||{};
  const place=st.place||(st.data&&st.data.place)||{};
  const days=(st.data&&st.data.daily)||[];
  const attr=(st.data&&st.data.attribution)||{text:'天气服务由和风天气提供',url:'https://www.qweather.com',icons:'图标来自和风天气开源图标库（qwd/Icons），按 CC BY 4.0 使用。',iconsUrl:'https://github.com/qwd/Icons'};
  let body='';
  if(st.configured===false)body='<p class="wx-err">天气服务尚未配置。</p>';
  else if(st.loading&&!st.data)body='<p class="wx-err">正在获取天气…</p>';
  else if(st.err&&!st.data)body=`<p class="wx-err">${esc(st.err)}</p>`;
  else if(st.data){
    const loc=[place.name,place.adm1].filter(Boolean).join(' · ');
    body=`<div class="wx-now">${wxIcon(d.icon||'100','wx-now-ico')}<div><div class="wx-loc">${esc(loc||'当前地点')}</div><div class="wx-temp">${Number.isFinite(d.temp)?d.temp+'°':''}</div><div class="wx-txt">${esc(d.text||'')}${Number.isFinite(d.feelsLike)?' · 体感 '+d.feelsLike+'°':''}</div><div class="wx-meta">${d.humidity!=null?'湿度 '+d.humidity+'%':''}${d.windDir?' · 风 '+esc(String(d.windDir))+(d.windScale!=null?String(d.windScale)+'级':''):''}</div></div></div>
    <div class="wx-days">${days.map(x=>`<div class="wx-day">${wxIcon(x.icon)}<b>${esc(wxDateLabel(x.date))}</b><small>${esc(x.text||'')}</small><span>${Number.isFinite(x.tempMin)?x.tempMin+'°':''} / ${Number.isFinite(x.tempMax)?x.tempMax+'°':''}</span></div>`).join('')}</div>`;
    if(st.err)body+=`<p class="wx-err">${esc(st.err)}</p>`;
  }
  const cities=st.cities;
  const list=cities&&cities.length?`<div class="wx-cities">${cities.map(c=>{const v=encodeURIComponent(JSON.stringify({id:c.id,name:c.name,adm1:c.adm1,adm2:c.adm2,country:c.country,lat:c.lat,lon:c.lon}));return `<button type="button" class="wx-city" data-a="wxcity" data-v="${v}">${esc(c.name)}${c.adm1?'<small>'+esc(c.adm1+(c.adm2&&c.adm2!==c.name?' · '+c.adm2:''))+'</small>':''}</button>`}).join('')}</div>`:(st.q&&!st.cloading&&!st.cerr?'<p class="wx-err">没有找到这个城市。</p>':'');
  return `<div class="pg wx-pg"><div class="top"><button class="ib" data-a="back" aria-label="返回">${typeof ic==='function'?ic('back'):'←'}</button><h1>天气</h1></div>
  <div class="sc">
    <div style="padding:8px 16px 0"><input class="fld" id="wxq" placeholder="搜索城市" value="${esc(st.q||'')}"></div>
    <div class="wx-actions"><button type="button" class="pb s wx-geo-btn" data-a="wxgeo"${st.geoSt==='busy'?' disabled':''}>${st.geoSt==='busy'?'正在定位…':'用我的位置'}</button></div>
    ${st.geoMsg?`<p class="wx-err">${esc(st.geoMsg)}</p>`:''}
    ${st.cloading?'<p class="wx-err">正在搜索…</p>':''}
    ${st.cerr?`<p class="wx-err">${esc(st.cerr)}</p>`:''}
    ${list}
    ${body}
    <p class="wx-attr wx-attr-page"><a href="${esc(attr.url||'https://www.qweather.com')}" target="_blank" rel="noopener">${esc(attr.text||'天气服务由和风天气提供')}</a> · <a href="${esc(attr.iconsUrl||'https://github.com/qwd/Icons')}" target="_blank" rel="noopener">图标来源 qwd/Icons</a>（CC BY 4.0）</p>
  </div></div>`;
}

async function wxUseMyLocation(){
  const st=weatherState();
  if(st.geoSt==='busy')return;
  st.geoSt='busy';st.geoMsg='';
  if(typeof render==='function')render(true);
  try{
    if(typeof geoGetPosition!=='function')throw {code:2,message:'unsupported'};
    const pos=await geoGetPosition();
    const lat=pos.lat!=null?pos.lat:pos.latitude;
    const lon=pos.lng!=null?pos.lng:(pos.lon!=null?pos.lon:pos.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))throw {code:2};
    const place={lat:Math.round(lat*100)/100,lon:Math.round(lon*100)/100,name:'',source:'geo'};
    wxSavePlace(place);
    st.geoSt='ok';st.geoMsg='';
    st.q='';st.cities=null;
    return loadWeather();
  }catch(e){
    st.geoSt='err';
    st.geoMsg=typeof geoErrMsg==='function'?geoErrMsg(e):'暂时获取不到位置，可以搜索城市，或者再试一次。';
    if(typeof render==='function')render(true);
  }
}

function applyWxCity(v){
  let p=null;
  try{p=JSON.parse(decodeURIComponent(String(v||'')))}catch(e){try{p=JSON.parse(String(v||''))}catch(e2){p=null}}
  if(!p)return;
  wxSavePlace(p);
  const st=weatherState();st.q='';st.cities=null;st.geoSt='';st.geoMsg='';
  if(!(S.st&&S.st[S.st.length-1]==='weather'))A.go('weather');
  return loadWeather();
}
