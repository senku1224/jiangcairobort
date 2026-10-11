# 酱菜冒险者公会

为「酱菜多人联机区」制作的 Steam 多人联机招募网页。暖色羊皮纸、手绘公会营地、游戏主题插画和完整的移动端布局。纯 HTML / CSS / JavaScript，无运行依赖、无 AI 接口，所有插画均在项目中，可离线加载。

## 运行

推荐安装 **Node.js 18 或更高版本**，在本项目目录打开终端：

```sh
npm start
```

浏览器打开 **http://localhost:4173**。无需执行 `npm install`。保持终端运行，按 `Ctrl+C` 停止服务。`server.cjs` 只是本机静态文件服务，不是共享数据后端，默认只监听 `127.0.0.1`。

页面默认会尝试连接共享数据库（见「共享数据库（Supabase）」）。连接失败时会自动回退到本地演示模式，并在界面给出提示，不会假装已经连上。地址加 `?backend=local` 可强制使用本地模式。

也可以直接双击 `index.html` 体验；部分浏览器限制 `file://` 的持久化与跨标签页协调，因此推荐使用上面的本地服务。双击打开和本地服务不是同一存储空间；端口或域名变更也会使用不同的存储空间。

## 页面结构与已实现功能

- **公会大厅**：欢迎横幅、四项招募统计、开放委托、公会公告、个人概况。
- **委托看板**：预设与自定义游戏、日期、状态、仅有空位、游戏名称搜索组合筛选；时间、发布时间或剩余名额排序；清除筛选与空列表提示。
- **发布委托**：必填验证、1–32 人总人数、发布者是否占位、语音要求、昵称、500 字备注；发布后立即显示并按最新发布排序。
- **报名管理**：报名、取消自己的报名、自动满员拦截、查看完整详情和队员；发布者可以结束或取消自己的委托；重要操作二次确认。
- **我的冒险**：已报名、已发布、可管理三种列表。发布者也可取消自己的报名，不影响发布权。
- **本地身份**：首次分配稳定的随机 ID，默认昵称为「酱菜见习生」；修改昵称会同步更新已有记录，同名不会获得其他人的权限。
- **本地持久化**：刷新后保留；示例委托单独标注，可一次清除且不会重新出现；支持导出 JSON 备份（当前没有导入按钮）。
- **易用性**：语义化标签、键盘焦点、原生模态对话框、错误提示、减少动画偏好、移动端适配。

首次运行生成 7 份示例：6 份有效招募和 1 份已截止记录。示例中的成员是虚构数据；示例数量、人数和开场时间仅用于体验。

## 状态与时间规则

所有日期输入和展示都使用 **北京时间 Asia/Shanghai（UTC+8）**，内部保存 ISO 时间戳。

优先级为：已取消 → 手动结束或开场截止 → 已满员 → 即将开始 → 正在招募。

- `open` 委托在开场前可以报名；剩余时间不超过一小时且仍有空位时显示「即将开始」。
- 满员显示「已满员」，取消报名会重新开放名额。
- 到开场时间即停止招募并显示「已结束」。这只表示**招募结束**，不代表游戏游玩已经结束。
- 页面可见时每 15 秒刷新状态；每一次实际操作都重新检查时间与人数，不依赖界面旧状态。
- 结束或取消后保留所有记录，禁止继续报名或退出。取消和结束不可撤回。
- 大厅与看板默认隐藏结束和取消记录，可以通过状态筛选查看；我的冒险默认显示所有状态。

## 数据模型

**本地模式**的存储键：`jiangcai.guild.v1`，一个 JSON 文档保存身份和全部委托，避免分多次写入留下不一致状态。**共享模式**下，这些字段映射到 `quests` 与 `quest_members` 两张表（见「共享数据库（Supabase）」）。

```js
{
  version: 1,
  user: { id: "稳定的本地随机 ID", nickname: "酱菜见习生" },
  quests: [{
    id: "委托唯一 ID",
    game: "PEAK",
    owner: { id: "发布者 ID", nickname: "队长" },
    startAt: "2026-10-12T12:00:00.000Z",
    createdAt: "2026-10-11T08:00:00.000Z",
    capacity: 4,
    members: [{ id: "报名者 ID", nickname: "队友" }],
    voice: "any", // any / required / none
    note: "萌新友好，一起登顶",
    state: "open", // open / ended / cancelled
    isDemo: false
  }]
}
```

`status`、`date`、`time` 在 `snapshot()` 时计算，仅用于展示，不写入存储。报名与管理权限以 ID 判断，不以昵称判断。输入、容量和状态规则在数据层复核；所有进入 HTML 的用户文字都经过转义。

## 文件与接口层

```text
index.html              页面、筛选器与表单
css/style.css           统一主题、响应式布局、交互反馈
assets/guild-map.svg    原创公会营地插画
js/config.js            公开配置（Supabase URL + publishable key）
js/data.js              本地模式数据模型、校验、状态计算、localStorage 适配器
js/supabase-store.js    Supabase 共享数据服务（与本地服务同接口）
js/backend.js           后端选择：共享优先，失败回退本地
vendor/supabase-js.umd.js  本地内置的 Supabase 客户端（离线可用）
js/ui.js                卡片、插画、详情与纯筛选函数
js/app.js               路由、表单、弹窗、事件协调
server.cjs              零依赖本地静态服务器
supabase/schema.sql     数据表、触发器与 RLS 策略
supabase/phase1-identity.sql  阶段 1：身份表 + 归属列改 uuid + RLS 收紧
tests/data.test.cjs     数据规则与筛选回归测试
tests/browser.cjs       Chrome 浏览器交互与响应式检查
```

`GuildData.createService(storage)` 返回异步接口：`init()`、`snapshot()`、`updateNickname()`、`createQuest()`、`joinQuest()`、`leaveQuest()`、`finishQuest()`、`clearDemo()`、`exportData()`。`GuildSupabase.createSupabaseService(client, storage)` 提供**完全相同**的接口，`js/backend.js` 负责二选一，界面层不需要关心用的是哪一个。两份实现都在数据层复核输入、容量与状态规则；所有进入 HTML 的用户文字都经过转义。

## 验证

```sh
npm run check
npm test
npm run test:browser
```

前两项只需要 Node.js。第三项需要本机安装 Chrome（默认检测 Windows 标准路径；其他系统可设置 `CHROME_PATH` 为 Chromium/Chrome 的完整路径），会自动启动专用静态服务与独立的无头浏览器，不使用个人浏览器资料。浏览器截图和测试存储输出至忽略目录 `test-results/`。Node.js 22+ 用于浏览器检查，因为测试使用内置 WebSocket。

建议手动体验：发布自定义游戏 → 查看详情 → 取消报名 → 重新报名 → 改昵称 → 刷新 → 在我的冒险结束委托 → 筛选已结束 → 清除示例 → 再次刷新确认不会恢复。

## 共享数据库（Supabase）

项目已接入 Supabase：招募与报名数据存放在共享数据库，群友看到的是**同一份**公告板。

- 公开配置在 `js/config.js`（Project URL + publishable key）。publishable key 本就是给浏览器用的公开密钥，**不要**在这里放 secret / service_role key。
- 数据表结构在 `supabase/schema.sql`（基础表）与 `supabase/phase1-identity.sql`（身份地基：新增表 + 归属列改 uuid + 收紧 RLS）。两者都需要在 Supabase 控制台 → SQL Editor 里整段执行一次，**先 schema，后 phase1**。
- 身份接入还需在控制台开启：Authentication → Sign In / Providers → **Anonymous sign-ins**（否则网页会回退到本地演示模式并给出提示）。
- 表：`quests`（招募）、`quest_members`（报名），以及 `profiles`（冒险者档案）、`link_codes`（QQ 绑定码）、`groups`（群白名单）。含主键、外键关联、创建时间、招募状态、人数上限、语音要求、备注等字段。
- 触发器 `enforce_member_rules` 在数据库层再校验一次「委托是否已截止 / 是否已满员」，防止绕过前端造成超员或给已截止委托报名；`protect_profile_columns` 保证 QQ 绑定关系只能由服务端写入。
- 客户端库已内置在 `vendor/supabase-js.umd.js`，因此仍然**不需要** `npm install`，也能离线打开本地模式。
- 连接失败（未建表 / 未开匿名登录 / 网络不通）时自动回退到本地演示模式，并在界面给出明确提示，**不会假装已连上**。

**localStorage 现在只用于：** 本地模式下的完整演示数据、匿名登录会话（`jiangcai.guild.auth.v1`）、昵称，以及界面状态。共享模式下，跨浏览器的业务数据一律以数据库为准。

## 身份与权限（重要）

网站会为每个浏览器自动做一次 **Supabase 匿名登录**，得到一个真实的 `auth.uid()`，并据此决定权限：

- 可以：查看公告板、发布委托（记在自己名下）、报名、取消自己的报名、结束或取消自己发起的委托。
- 数据库已开启 Row Level Security，并按 `auth.uid()` 判归属：
  - `quests`：`insert / update / delete` 都要求 `auth.uid() = owner_id`，**改不了也删不了别人的委托**。
  - `quest_members`：`insert / update / delete` 都要求 `auth.uid() = user_id`，**动不了别人的报名**。
  - `profiles`：只能读写自己那一行；`qq_number` / `bound_at` 由触发器保护，**网页端无法自行写入**，只能由持有 service key 的可信后端核销绑定码后写入。
  - `link_codes`：网页端只能创建/查看/作废自己的绑定码。
- **它不是账号**：匿名身份保存在当前浏览器，换浏览器或清空数据会变成新身份（旧记录还在，但不再属于"你"）。要跨设备认人，需要绑定 QQ 或后续接入正式登录。
- 因此现在的权限定位是「**防越权**」：别人改不动你的记录；反过来，你也不再能修改别人的数据。这是设计目标，不是缺陷。

## 后续步骤

1. **身份地基（阶段 1）**：开启 Supabase 匿名登录，并在 SQL Editor 运行 `supabase/phase1-identity.sql`。
2. **QQ 绑定核销（阶段 2）**：机器人后端用 service key 核销绑定码，写入 `profiles.qq_number`（service key 只放本机 `.env`）。
3. **机器人写入（阶段 3）**：`/报名`、`/取消`、`/我的` 经可信后端写库。
4. **公开部署**：静态站点已托管在 GitHub Pages（公开地址）；若要限制访问，需要带访问控制的托管。
5. **网络可达性**：当前网络直连 Supabase / GitHub 会被重置，需要代理；要让群友无代理可用，需把后端与托管迁到网络可达的位置。

现代浏览器在 HTTP 同源多标签页中通过 Web Locks 串行处理本地修改，并通过 `storage` 事件刷新其他标签页。共享模式下由 15 秒轮询与页面重新可见时的刷新保证数据新鲜度。

## 存储故障排查

- 无法保存：允许本站本地存储，检查浏览器存储空间；操作失败会明确显示错误，不假装已经保存。
- 数据格式损坏：程序保留原数据并停止加载，不自动覆盖。可在浏览器开发者工具的「应用 → 本地存储」中复制 `jiangcai.guild.v1` 的原值备份，修复后刷新。
- 如果不需要旧数据，可以在备份后手动删除该键，刷新重建示例；**删除该键会清除本地身份和全部记录**。
- 清除示例只删除 `isDemo: true` 的委托。页脚备份会包含昵称和报名记录，请自行保管。
