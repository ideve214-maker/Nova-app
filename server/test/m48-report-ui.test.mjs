// M4.8：登录后从动态「更多」提交真实举报，进入管理端队列。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = readFileSync(join(root, 'dist/nova_v5.html'), 'utf8');

test('构建产物已接通真实举报与拉黑接口，私聊说明只提交勾选消息', () => {
  assert.match(dist, /POST['"],'\/api\/reports'/);
  assert.match(dist, /\/api\/blocks/);
  assert.match(dist, /勾选要提交的消息/);
  assert.match(dist, /不会把整段会话交给管理员/);
  assert.doesNotMatch(dist, /举报（仅演示）/);
});

let browser;
test('登录后举报帖子会写入服务器队列', async () => {
  browser = await launch();
  const S = await startServer({adminUsername: 'ops_ui', adminPassword: 'OpsUiPass1'});
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'rptui');
    await p.click('#v [data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '这条会被自己举报用于测试。');
    await p.click('[data-a=pub]');
    await p.waitForFunction(() => document.body.innerText.includes('这条会被自己举报用于测试。'));
    await p.click('#v [data-a=more]');
    await p.waitForSelector('[data-a=reportp]');
    await p.click('[data-a=reportp]');
    await p.waitForSelector('[data-a=rpsubmit]');
    assert.match(await p.locator('.pn').innerText(), /选择原因/);
    await p.click('[data-a=rpreason][data-v=spam]');
    await p.fill('[data-d=rpdetail]', '测试说明');
    await p.click('[data-a=rpsubmit]');
    await p.waitForFunction(() => document.body.innerText.includes('已提交'));
    const listed = S.srv.reports.list({status: 'pending'});
    assert.ok(listed.reports.some(r => r.reason.includes('垃圾') && r.detail === '测试说明'), JSON.stringify(listed));
  } finally {
    await p.context().close();
    await S.close();
    await browser.close();
  }
});
