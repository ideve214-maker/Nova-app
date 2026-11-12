#!/usr/bin/env node
// 创建或列出平台管理员。用法：
//   node server/admin-cli.mjs create --username NAME --password PASS [--db ./nova.db]
//   node server/admin-cli.mjs list [--db ./nova.db]
// 密码也可来自环境变量 NOVA_ADMIN_PASSWORD；没有内置默认密码。
import {parseArgs} from 'node:util';
import {openDb} from './db.mjs';
import {createAdmins} from './admin.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const {values} = parseArgs({
  args: rest,
  options: {
    username: {type: 'string', short: 'u'},
    password: {type: 'string', short: 'p'},
    email: {type: 'string'},
    db: {type: 'string'},
    role: {type: 'string'},
  },
  allowPositionals: true,
});
const dbPath = values.db || process.env.NOVA_DB || './nova.db';

function usage() {
  console.log(`NOVA 管理员工具
  node server/admin-cli.mjs create --username NAME --password PASS [--db ./nova.db]
  node server/admin-cli.mjs list [--db ./nova.db]

密码必须 8–128 位且同时包含字母和数字。也可改用环境变量 NOVA_ADMIN_PASSWORD。
没有内置默认密码；生产环境请用足够强的口令，不要把口令写入仓库。`);
}

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(cmd ? 0 : 1);
}

const db = openDb(dbPath);
const admins = createAdmins(db, {now: Date.now});

try {
  if (cmd === 'create') {
    const username = values.username;
    const password = values.password || process.env.NOVA_ADMIN_PASSWORD;
    if (!username || !password) {
      console.error('请同时提供 --username 与 --password（或环境变量 NOVA_ADMIN_PASSWORD）。不会使用默认密码。');
      process.exit(2);
    }
    const admin = admins.create({username, password, email: values.email, role: values.role});
    console.log('已创建管理员：' + admin.username + '（id=' + admin.id + '，角色=' + admin.role + '）');
    console.log('数据库：' + dbPath);
  } else if (cmd === 'list') {
    const rows = admins.list();
    if (!rows.length) {
      console.log('还没有管理员账号。请用 create 子命令创建第一个。');
    } else {
      for (const a of rows) console.log(`${a.id}\t${a.username}\t${a.role}\t${a.status}`);
    }
  } else {
    console.error('未知命令：' + cmd);
    usage();
    process.exit(1);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  try { db.close(); } catch {}
}
