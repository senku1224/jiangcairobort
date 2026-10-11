/* 无外部依赖的浏览器验收：使用独立 Chrome 资料和原生 DevTools 协议。 */
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 4187;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let browser;
let server;
let connection;
let chromeLog = '';
let requestId = 0;
const pending = new Map();
const errors = [];

async function until(operation, description) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if (await operation()) return; } catch {}
    await pause(100);
  }
  throw new Error(`等待超时：${description}\n${chromeLog.slice(-1500)}`);
}

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const identifier = ++requestId;
    const timer = setTimeout(() => { pending.delete(identifier); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(identifier, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    connection.send(JSON.stringify({ id: identifier, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64'));
}

async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(120);
}

async function field(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(element.type === 'search' ? 'input' : 'change', { bubbles: true })); })()`);
  await pause(60);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'chrome-profile-'));
  server = spawn(process.execPath, ['server.cjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: 'pipe' });
  server.stderr.on('data', chunk => { chromeLog += chunk; });
  await until(async () => (await fetch(`http://127.0.0.1:${port}`)).ok, '本地服务');
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'pipe' });
  browser.on('error', error => { chromeLog += error.message; });
  browser.stderr.on('data', chunk => { chromeLog += chunk; });
  let debuggerPort;
  await until(async () => {
    debuggerPort = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    return debuggerPort > 0;
  }, 'Chrome 调试端口');
  const targets = await (await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json();
  connection = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { connection.addEventListener('open', resolve, { once: true }); connection.addEventListener('error', reject, { once: true }); });
  connection.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const operation = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/?backend=local` });
  await until(() => evaluate('document.querySelectorAll(".quest-card").length === 6'), '首页示例委托');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate('document.querySelector("#fatal-error").hidden'), true);
  await screenshot('desktop.png');
  await evaluate('window.scrollTo({top: 570, behavior: "instant"})');
  await screenshot('desktop-board.png');
  await evaluate('window.scrollTo({top: 0, behavior: "instant"})');
  console.log('PASS 桌面首页、六份开放委托、无横向溢出');

  await field('#search', '不存在的自定义游戏');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 0);
  await click('#clear-filters');
  await field('#filter-game', 'PEAK');
  await field('#filter-status', 'soon');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 1);
  await field('#filter-date', '2099-01-01');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 0);
  await click('#clear-filters');
  console.log('PASS 游戏、状态、日期组合筛选和清除');

  await click('[data-action="join"][data-id="demo-2"]');
  assert.ok(await evaluate('document.querySelector("[data-quest=demo-2]").textContent.includes("已满员")'));
  await click('[data-action="leave"][data-id="demo-2"]');
  assert.equal(await evaluate('document.querySelector("#confirm-dialog").open'), true);
  await click('#confirm-dialog [data-dismiss]');
  assert.ok(await evaluate('document.querySelector("[data-quest=demo-2]").textContent.includes("你在队伍中")'));
  await click('[data-action="leave"][data-id="demo-2"]');
  await click('#confirm-submit');
  assert.ok(await evaluate('document.querySelector("[data-quest=demo-2]").textContent.includes("正在招募")'));
  console.log('PASS 报名满员、取消确认、退出恢复名额');

  await click('.page-heading [data-action="create"]');
  await field('#create-game', '   ');
  await click('#create-form [type="submit"]');
  assert.equal(await evaluate('document.querySelector("#create-error").hidden'), false);
  const tomorrow = await evaluate('GuildData.beijingParts(Date.now()+86400000).date');
  await field('#create-game', '测试自定义 <img src=x>');
  await field('#create-form [name=date]', tomorrow);
  await field('#create-form [name=time]', '20:00');
  await field('#create-form [name=capacity]', '2');
  await field('#create-form [name=nickname]', '测试冒险者');
  await field('#create-form [name=note]', '<script>window.injected=true</script> 萌新友好');
  await click('#create-form [type="submit"]');
  await until(() => evaluate('!document.querySelector("#create-dialog").open'), '发布成功');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 7);
  assert.equal(await evaluate('document.querySelector(".quest-card h3").textContent'), '测试自定义 <img src=x>');
  assert.equal(await evaluate('window.injected === undefined'), true);
  assert.equal(await evaluate('document.querySelectorAll(".quest-card img").length'), 0);
  const questId = await evaluate('document.querySelector(".quest-card").dataset.quest');
  await click(`[data-action="detail"][data-id="${questId}"]`);
  assert.ok(await evaluate('document.querySelector("#detail-content").textContent.includes("测试冒险者")'));
  await click('#detail-dialog [data-dismiss]');
  await click('[data-page="mine"]');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 1);
  console.log('PASS 自定义发布、必填提示、内容转义、详情与我的报名');

  await click('.topbar [data-action="profile"]');
  await field('#profile-form [name=nickname]', '改名后的冒险者');
  await click('#profile-form [type=submit]');
  await command('Page.reload');
  await until(() => evaluate('document.querySelector(".user-name")?.textContent === "改名后的冒险者"'), '刷新后身份持久化');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 1);
  assert.ok(await evaluate('document.querySelector(".quest-card").textContent.includes("改名后的冒险者")'));
  await click('[data-mine="manageable"]');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 1);
  await click(`[data-action="detail"][data-id="${questId}"]`);
  await click('#detail-dialog [data-action="end"]');
  await click('#confirm-submit');
  assert.ok(await evaluate('document.querySelector("#detail-content").textContent.includes("已结束")'));
  await click('#detail-dialog [data-dismiss]');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 0);
  await click('[data-mine="published"]');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 1);
  console.log('PASS 改名不丢身份、刷新持久化、结束委托和管理列表');

  await click('.page-heading [data-action=create]');
  await field('#create-game', '取消流程验证');
  await click('#create-form [type=submit]');
  await until(() => evaluate('!document.querySelector("#create-dialog").open'), '第二份委托发布');
  await click('.quest-card [data-action=detail]');
  await click('#detail-dialog [data-action=cancel]');
  await click('#confirm-submit');
  assert.ok(await evaluate('document.querySelector("#detail-content").textContent.includes("已取消")'));
  await click('#detail-dialog [data-dismiss]');
  await click('[data-action=clear-demo]');
  await click('#confirm-submit');
  await command('Page.reload');
  await until(() => evaluate('document.querySelector("#clear-demo")?.disabled === true'), '清除示例持久化');
  await field('#filter-status', 'all');
  assert.equal(await evaluate('document.querySelectorAll(".quest-card").length'), 2);
  console.log('PASS 取消委托、清除示例保留自建数据、刷新不恢复示例');

  await evaluate('localStorage.removeItem(GuildData.STORAGE_KEY)');
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/?backend=local&mobile=1#hall` });
  await until(() => evaluate('document.querySelectorAll(".quest-card").length === 6 && document.querySelector("#hall-hero").hidden === false'), '新演示供手机截图');
  for (const width of [390, 320, 768]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await pause(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `页面在 ${width}px 溢出`);
    if (width === 390) {
      await screenshot('mobile.png');
      await click('.page-heading [data-action=create]');
      assert.equal(await evaluate('document.querySelector("#create-dialog").scrollWidth <= document.querySelector("#create-dialog").clientWidth'), true);
      await screenshot('mobile-form.png');
      await click('#create-dialog [data-dismiss]');
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS 320 / 390 / 768px 响应式、手机表单、浏览器无未处理异常');
  console.log(`截图保存在 ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (connection?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch {}
    connection.close();
  }
  if (browser && browser.exitCode === null) browser.kill();
  if (server && server.exitCode === null) server.kill();
});
