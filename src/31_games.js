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
function pGames(){
  const tiles=GAMES.map(g=>{
    const best=gameBest(g.id);
    const mark=esc(g.name).slice(0,1);
    const score=g.score?(best!=null?('最高 '+esc(best)):'还没有成绩'):'无计分';
    return `<button type="button" class="gtile" data-a="game" data-v="${esc(g.id)}"><span class="gico">${mark}</span><b>${esc(g.name)}</b><small>${esc(g.desc)}</small><em>${score}</em></button>`;
  }).join('');
  return `<div class="pg">${sub('小游戏')}<div class="sc"><p class="hint" style="padding:12px 16px 0">成绩只存在这台设备。</p><div class="gtiles">${tiles}</div></div></div>`;
}
function pGame(id){
  const g=GAMES.find(x=>x.id===id);
  if(!g)return `<div class="pg">${sub('小游戏')}<div class="sc"><p class="em">没有这个游戏</p></div></div>`;
  S.gameId=id;
  return `<div class="pg game-pg">${sub(esc(g.name))}<div class="sc game-frame"><iframe title="${esc(g.name)}" src="assets/games/${esc(g.id)}/index.html" data-game="${esc(g.id)}"></iframe></div></div>`;
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
