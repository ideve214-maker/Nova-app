/* 小游戏目录。游戏本体在 assets/games/<id>/，离线运行。 */
const GAMES = [
  {id:'2048', name:'2048', desc:'滑动合并相同数字。', score:true},
  {id:'tower', name:'盖楼', desc:'把楼层叠得越高越好。', score:true},
  {id:'gobang', name:'五子棋', desc:'和电脑下五子棋。', score:false},
  {id:'chess', name:'中国象棋', desc:'经典象棋对局。', score:false},
  {id:'snake', name:'贪吃蛇', desc:'吃到食物就变长。', score:true},
  {id:'solitaire', name:'纸牌接龙', desc:'把牌按花色收齐。', score:false},
  {id:'reversi', name:'黑白棋', desc:'翻转对手的棋子。', score:false},
  {id:'calc24', name:'24点', desc:'用四个数算出 24。', score:false},
  {id:'mines', name:'扫雷', desc:'标出所有地雷。', score:false},
  {id:'sudoku', name:'数独', desc:'填满九宫格。', score:false},
  {id:'c4', name:'四子棋', desc:'先连成四子的一方获胜。', score:false},
];
function gameBest(id){
  try{const n=localStorage.getItem('nova_game_best_'+id);return n==null||n===''?null:n}catch(e){return null}
}
function saveGameBest(id, score){
  const n=Number(score)||0;
  if(!(n>0))return;
  const prev=Number(gameBest(id)||0);
  if(n>prev){try{localStorage.setItem('nova_game_best_'+id, String(n))}catch(e){}}
}
/* 自绘描边图标，与设置/发帖的 icLine 同一套 stroke 风格，使用 currentColor。 */
const GAME_ICO={
  '2048':'<rect x="3.2" y="3.2" width="8.2" height="8.2" rx="1.6"/><rect x="12.6" y="3.2" width="8.2" height="8.2" rx="1.6"/><rect x="3.2" y="12.6" width="8.2" height="8.2" rx="1.6"/><rect x="12.6" y="12.6" width="8.2" height="8.2" rx="1.6"/><path d="M14.5 15.3h4M16.5 15.3v4"/>',
  tower:'<rect x="6.4" y="14.6" width="11.2" height="5.2" rx="1.2"/><rect x="5.2" y="8.8" width="13.6" height="5.2" rx="1.2"/><rect x="7" y="3.2" width="10" height="5.2" rx="1.2"/>',
  gobang:'<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2"/><path d="M8 3.2v17.6M16 3.2v17.6M3.2 8h17.6M3.2 16h17.6"/><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.7"/>',
  chess:'<circle cx="12" cy="9.6" r="5.6"/><path d="M12 6.4v6.4M9.2 9.6h5.6"/><path d="M6.8 17.2h10.4M8.2 19.4h7.6M9.2 15.2h5.6"/>',
  snake:'<path d="M5 16.6c0-2 1.6-3.5 3.5-3.5h3.4c1.15 0 1.15-2.1 0-2.1H9.4c-2.5 0-4.4-1.9-4.4-4.2 0-2.2 1.9-3.6 4.3-3.6h5.4c2.2 0 4 1.5 4 3.5"/><circle cx="17.2" cy="6.8" r="1.05" fill="currentColor" stroke="none"/><rect x="15" y="14.4" width="4.6" height="4.6" rx="1"/>',
  solitaire:'<rect x="3.6" y="5.8" width="11" height="14" rx="1.6"/><rect x="9.4" y="4.2" width="11" height="14" rx="1.6"/><path d="M14.9 8.6l2.2 3.2 2.2-3.2-2.2-2.3z"/>',
  reversi:'<circle cx="8.1" cy="12" r="5"/><circle cx="8.1" cy="12" r="2.15" fill="currentColor" stroke="none"/><circle cx="15.9" cy="12" r="5"/>',
  calc24:'<rect x="3.2" y="3.2" width="8" height="8" rx="1.5"/><rect x="12.8" y="3.2" width="8" height="8" rx="1.5"/><rect x="3.2" y="12.8" width="8" height="8" rx="1.5"/><rect x="12.8" y="12.8" width="8" height="8" rx="1.5"/><path d="M5.4 7.2h3.6M14.8 6.2v3.6M5.4 16.8h3.6M16.8 14.6v4.4M14.6 16.8h4.4"/>',
  mines:'<circle cx="12" cy="12" r="4.1"/><path d="M12 3.2v3.1M12 17.7v3.1M3.2 12h3.1M17.7 12h3.1M5.7 5.7l2.2 2.2M16.1 16.1l2.2 2.2M18.3 5.7l-2.2 2.2M7.9 16.1l-2.2 2.2"/><circle cx="10.6" cy="10.6" r=".8" fill="currentColor" stroke="none"/>',
  sudoku:'<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2"/><path d="M9.1 3.2v17.6M14.9 3.2v17.6M3.2 9.1h17.6M3.2 14.9h17.6"/><rect x="4.5" y="4.5" width="3.2" height="3.2" rx=".4" fill="currentColor" stroke="none"/><rect x="10.4" y="10.4" width="3.2" height="3.2" rx=".4" fill="currentColor" stroke="none"/><rect x="16.3" y="16.3" width="3.2" height="3.2" rx=".4" fill="currentColor" stroke="none"/>',
  c4:'<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/><circle cx="7.2" cy="8" r="1.65"/><circle cx="12" cy="8" r="1.65"/><circle cx="16.8" cy="8" r="1.65"/><circle cx="7.2" cy="12.6" r="1.65" fill="currentColor" stroke="none"/><circle cx="12" cy="12.6" r="1.65" fill="currentColor" stroke="none"/><circle cx="16.8" cy="12.6" r="1.65" fill="currentColor" stroke="none"/><circle cx="7.2" cy="17.2" r="1.65" fill="currentColor" stroke="none"/><circle cx="12" cy="17.2" r="1.65"/><circle cx="16.8" cy="17.2" r="1.65"/>'
};
function gameIcon(id){
  const inner=GAME_ICO[id]||'';
  return `<svg class="gico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
function pGames(){
  const tiles=GAMES.map(g=>{
    const best=gameBest(g.id);
    const score=g.score?(best!=null?('最高 '+esc(best)):'还没有成绩'):'无计分';
    return `<button type="button" class="gtile" data-a="game" data-v="${esc(g.id)}"><span class="gico">${gameIcon(g.id)}</span><b>${esc(g.name)}</b><small>${esc(g.desc)}</small><em>${score}</em></button>`;
  }).join('');
  return `<div class="pg">${sub('小游戏')}<div class="sc"><p class="hint" style="padding:12px 16px 0">成绩只存在这台设备。</p><div class="gtiles">${tiles}</div></div></div>`;
}
/* 1.0.7：热更新包不再带小游戏（体积太大，手机网络下载会超时），改从服务器加载；完整安装包仍用本地文件。 */
function gameBase(){const b=typeof window!=='undefined'&&window.NOVA_GAMES_BASE;return b?String(b).replace(/\/?$/,'/'):'assets/games/'}
function pGame(id){
  const g=GAMES.find(x=>x.id===id);
  if(!g)return `<div class="pg">${sub('小游戏')}<div class="sc"><p class="em">没有这个游戏</p></div></div>`;
  S.gameId=id;
  return `<div class="pg game-pg">${sub(esc(g.name))}<div class="sc game-frame"><iframe title="${esc(g.name)}" src="${esc(gameBase())}${esc(g.id)}/index.html" data-game="${esc(g.id)}"></iframe></div></div>`;
}
if(typeof window!=='undefined' && !window.__novaGameScore){
  window.__novaGameScore=1;
  window.addEventListener('message', e=>{
    const d=e.data;
    if(!d || d.type!=='nova-score')return;
    const id=d.game||S.gameId;
    if(!id)return;
    saveGameBest(id, d.score);
  });
}
