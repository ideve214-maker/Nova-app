/* 专属表情包（M2.5.5）。香槟金系列是原创 Unicode 白名单。
   VIP 可从面板选用；所有人都能看见已发出的贴纸并继续用基础包交流。演示模式只能用基础包。 */
const STK={cat:null};
const STK_BASIC={id:'basic',title:'常用表情',premium:false,usable:true,items:[{id:'smile',glyph:'😊',name:'微笑'},{id:'heart',glyph:'❤️',name:'爱心'},{id:'thumb',glyph:'👍',name:'赞'},{id:'laugh',glyph:'😂',name:'大笑'},{id:'wow',glyph:'😮',name:'惊讶'},{id:'sad',glyph:'😢',name:'难过'},{id:'fire',glyph:'🔥',name:'火'},{id:'wave',glyph:'🙌',name:'加油'}]};
const STK_GOLD={id:'nova_gold',title:'香槟金系列',premium:true,usable:false,entitlement:'premium_emoji_pack',items:[{id:'gold_star',glyph:'🌟',name:'金星'},{id:'gold_cheers',glyph:'🥂',name:'香槟'},{id:'gold_sparkle',glyph:'✨',name:'闪光'},{id:'gold_crown',glyph:'👑',name:'皇冠'},{id:'gold_rose',glyph:'🌹',name:'玫瑰'},{id:'gold_moon',glyph:'🌙',name:'月夜'},{id:'gold_book',glyph:'📖',name:'书页'},{id:'gold_coffee',glyph:'☕',name:'咖啡'}]};
function stkPacks(){
  if(STK.cat&&STK.cat.packs)return STK.cat.packs;
  const gold={...STK_GOLD,usable:typeof vipFlag==='function'&&vipFlag('premium_emoji_pack')};
  return [STK_BASIC,gold]}
async function loadStickers(){
  if(!NET)return;const r=await api('GET','/api/stickers');if(r.s===200)STK.cat=r.j}
function stkView(s){const o=s&&typeof s==='object'?s:null;return o?`<span class="stk" data-stk="${esc((o.pack||'')+':'+(o.id||''))}" role="img" aria-label="${esc(o.name||'贴纸')}">${o.glyph||''}</span>`:esc(String(s||''))}
function stkLabel(s){return s&&typeof s==='object'?((s.glyph||'')+' '+(s.name||'贴纸')):String(s||'')}
function stkp(v){S.sh={t:'stk',cid:v};if(MODE==='account')return loadStickers()}
function stkuse(v){
  const[pack,id]=v.split('|'),packs=stkPacks(),p=packs.find(x=>x.id===pack),it=p&&p.items.find(x=>x.id===id);
  if(!it)return T('贴纸不存在');
  if(p.premium&&!p.usable){S.sh=null;T('这项功能需要 VEXO VIP，才能使用「专属表情包」。');return}
  const sendLocal=st=>{const cid=S.sh&&S.sh.cid;S.sh=null;if(!cid)return;(D.m[cid]=D.m[cid]||[]).push(['me','k','刚刚','已发送',st,newId()]);const i=D.cv.findIndex(c=>c.id==cid);if(i>=0){const c=D.cv.splice(i,1)[0];D.cv.unshift(c)}S.bot=1;T('已发送 '+st.name)};
  const st={pack,id,glyph:it.glyph,name:it.name,premium:!!p.premium};
  if(MODE==='account'&&NET&&SESSION)return api('POST','/api/stickers/use',{pack,id}).then(r=>{
    if(r.s!==200){T(errMsg(r,'无法使用这张贴纸'));return}
    const st2=r.j.sticker,cid=S.sh&&S.sh.cid;S.sh=null;
    if(!cid||typeof sendNet!=='function')return;
    return sendNet(cid,st2.glyph||'',{sticker:{pack:st2.pack,id:st2.id,glyph:st2.glyph,name:st2.name,premium:!!st2.premium}}).then(m=>{if(m){S.bot=1;T('已发送 '+st2.name)}});
  });
  sendLocal(st)}
