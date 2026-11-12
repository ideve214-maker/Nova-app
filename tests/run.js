const T = require('./lib');
(async () => {
  await T.start();
  for (const f of ['t_baseline', 't_m1', 't_m2', 't_m3', 't_m4', 't_crop']) { try { await require('./' + f)(); } catch (e) { console.log('测试文件异常', f, e); } }
  const n = T.summary(); await T.stop(); process.exit(n ? 1 : 0);
})();
