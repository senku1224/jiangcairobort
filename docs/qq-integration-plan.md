# QQ 登录 / 机器人接入方案

> 状态：**设计稿（尚未实现）**。本文只做方案设计，没有改动线上数据。
> 相关：项目说明见 `README.md`；数据库结构见 `supabase/schema.sql`。

## 0. 目标

1. 用**真实 QQ 身份**取代当前"浏览器本地随机 ID"，把权限从「防误伤 + 防超员」升级为「防越权」。
2. 让 QQ 群里的机器人能：查招募、发招募、报名、取消报名、@提醒。
3. 网页与机器人共用同一份 Supabase 数据。

非目标（暂不做）：AI 对话、多群运营、复杂审核后台。

## 1. 现状与约束

- 网站：静态页 + Supabase，前端只持有 publishable key。
- 身份：`jiangcai.guild.identity.v1` 里的随机 ID，**可被伪造**。
- 数据库：`quests` / `quest_members`，归属列 `owner_id` / `user_id` 目前是 `text`。
- RLS：读全开、可发布/报名、删除委托仅限示例 → 挡得住误伤与超员，**挡不住越权改他人数据**。

三个硬约束：

- **service key 绝不能进前端**；任何"可信"操作必须放到服务端。
- QQ 没有"给个人网站用的零门槛 OAuth"：QQ 互联需要**备案域名 + 审核**。
- 机器人有两条差别很大的路线（官方 / 第三方），能力与风险不同。

## 2. 两条机器人路线

### 路线 A：QQ 官方机器人（开放平台 q.qq.com）

- 合规、稳定、不易封号；支持频道 / 群 / 单聊，支持 WebSocket 或 WebHook。
- 需要**主体认证**（个人或企业）；正式环境要配 **IP 白名单**；群场景需群主/管理员把机器人拉进群。
- 群内能力与按钮交互受平台配置与审核影响，发布上线有流程。
- 生态：官方 SDK（botpy / botgo / bot-node-sdk）或 AstrBot、NoneBot 等框架的官方适配器。

### 路线 B：第三方 OneBot（NapCat / LLOneBot 等）

- 通过 NTQQ 登录一个真实 QQ 号，对外输出标准 **OneBot v11** 协议（HTTP / WebSocket）。
- 能力最全（群消息、图片、按钮、成员列表），部署灵活；go-cqhttp 已停维护，**NapCat 是当前主流**。
- **非官方，有被腾讯风控 / 封号风险**；需要一个 QQ 号常在线（建议小号）+ 一台常开服务器。

**建议**：先用 **B** 快速跑通（自用 / 小群验证体验），把 **A** 作为正式化目标。业务逻辑写在抽象层，两条路线只换「适配器」。

## 3. 身份方案：怎么实现"QQ 登录"

### 方案 1：QQ 互联 OAuth（官方 QQ 登录）

- 走 `connect.qq.com`，用户授权后拿到 OpenID。
- 需要**已备案域名**、回调地址，创建应用并**审核**（约 5 个工作日）；未过审时只有开发者账号能登录。
- 优点：最正式、最稳。缺点：备案 + 审核是硬门槛，个人小项目常卡在这。
- 适合：网站已正式部署、有备案域名之后。

### 方案 2：机器人中转绑定（推荐先做，无审核）

- 网站在「冒险者名片」点「绑定 QQ」→ 生成一个 **6 位一次性绑定码**（5 分钟有效）。
- 用户把绑定码私聊 / 发群给机器人。
- 机器人后端（可信）从事件里拿到**真实 QQ 号**，核销绑定码，写入 `profiles`。
- 网站实时 / 轮询感知绑定完成，显示「已绑定 QQ：xxxx」。
- 身份 = **机器人会话里拿到的 QQ 号**，不是用户自称的昵称 → 可信。
- 可加限制：只允许本群成员绑定（机器人可查群成员列表）。

### 方案 3：群成员白名单（最轻）

- 不做绑定，"在群里"即通过。只适合只读场景，无法做个性化权限。

**推荐**：阶段一用**方案 2** 落地（不依赖审核）；网站有了正式备案域名后再叠加**方案 1**。

## 4. 目标架构

```
 ┌──────────┐      HTTPS       ┌────────────────────────────┐
 │  QQ 群    │ ───────────────▶ │  QQ 机器人（官方 or NapCat） │
 └──────────┘                  └─────────────┬──────────────┘
        ▲ 消息 / 按钮                          │ OneBot 事件 / 回调
        │                                      ▼
        │                     ┌────────────────────────────────┐
        │                     │  可信后端（持 service key）      │
        │                     │  - 校验 QQ 身份 / 群成员         │
        │                     │  - 绑定码核销、写 profiles       │
        │                     │  - 业务：查询 / 报名 / 发布      │
        │                     │  - 触发群通知                    │
        │                     └───────┬───────────────┬─────────┘
        │                   service key│               │ 用户会话
        │                              ▼               ▼
        │                     ┌────────────────────────────────┐
        └─────────────────────│            Supabase             │
                              │  Auth（匿名 → 绑定）+ Postgres    │
                              │  quests / quest_members          │
                              │  profiles / link_codes / groups  │
                              │  RLS 用 auth.uid() 判归属         │
                              └────────────────┬───────────────┘
                                               ▲ publishable key
                                     ┌─────────┴─────────┐
                                     │        网站        │
                                     └───────────────────┘
```

要点：

- **只有「可信后端」持有 service key**，前端永远只用 publishable key。
- 网页用户通过 Supabase Auth 拿到 `auth.uid()`；机器人后端用 service key 或为用户铸造的会话写入。

## 5. 数据模型改造

**新增：**

- `profiles(id uuid PK → auth.users, qq_number text unique, qq_openid text, nickname text, created_at, updated_at)`
- `link_codes(code text PK, user_id uuid → auth.users, platform text default 'qq', expires_at timestamptz, consumed_at timestamptz, created_at)`
- `groups(id bigint PK, platform text, group_id text unique, name text, enabled boolean, created_at)`

**改造现有表（把归属改成真实用户）：**

- `quests.owner_id`：`text` → `uuid` → `auth.users(id)`
- `quest_members.user_id`：`text` → `uuid` → `auth.users(id)`
- 可选：`quests.group_id`（标记委托来自哪个群，便于多群）

当前两张表是空的，**没有历史数据要迁移**，改类型成本很低。

## 6. RLS 改造：真正做到"只能改自己的"

替换现在的宽松策略：

- `quests`
  - select：`using (true)`（看板公开）
  - insert：`with check (auth.uid() = owner_id)`
  - update：`using (auth.uid() = owner_id) with check (auth.uid() = owner_id and state in ('open','ended','cancelled'))`
  - delete：`using (auth.uid() = owner_id or is_demo)`
- `quest_members`
  - select：`using (true)`
  - insert：`with check (auth.uid() = user_id)`
  - delete：`using (auth.uid() = user_id)`
  - update（改名）：`using (auth.uid() = user_id)`

容量与截止仍由 `enforce_member_rules` 触发器兜底。这样权限才从「防误伤」升级到「防越权」。

## 7. 可信后端

两种落地：

- **Supabase Edge Functions（Deno）**：适合绑定码核销、发放会话、RPC 式业务，贴近数据库。
- **独立 Node 服务**：机器人需要常驻进程（OneBot 走 WebSocket），Node 服务最自然，同时暴露少量 HTTP 接口。

建议：**一个 Node 服务**承担「机器人 + 绑定 + 业务」，纯 DB 逻辑可下沉到 Edge Function / RPC。

- 所有密钥（service key、机器人 AppSecret / OneBot token）只在该服务的环境变量里。
- 对前端只暴露必要接口；绑定接口一次性、限时、限频。

## 8. 机器人功能设计

命令（群内 @机器人 或私聊）：

- `/招募`、`招募列表`：返回最近开放的委托（游戏、时间、剩余名额）+ 网页链接。
- `/发布`：回复一条**带参数的网页链接**，让用户在网页上填（避免群内多轮复杂输入）。
- `/报名 <短号>` / `/取消 <短号>`：报名 / 取消；未绑定先引导绑定。
- `/我的`：我发布 / 我报名的。
- `/绑定`：返回绑定指引。
- 被动提醒：有人报名 → @发布者（官方群聊能力有限，OneBot 更易实现）。

安全要点：

- 一切身份以 **QQ 号（事件里的 user_id）** 为准，**绝不信昵称**。
- 写操作走「可信后端 → 数据库」，规则与网页端一致（容量、截止、重复）。
- 群内默认只读命令，防刷屏；敏感操作二次确认。

## 9. 分阶段落地

- **阶段 1 · 身份地基**（不依赖机器人平台选择）
  1. 开启 Supabase Auth，前端匿名登录 → 每浏览器一个真实 `auth.uid()`。
  2. 新增 `profiles` / `link_codes` / `groups`；`quests` / `quest_members` 归属列改为 uuid。
  3. 收紧 RLS 到「只能改自己的」。
  4. 网页「冒险者名片」加绑定入口（先生成绑定码）。
- **阶段 2 · 机器人只读**
  5. 起机器人（先 NapCat 跑通），实现 `/招募`、`/绑定`，只发链接不写库。
- **阶段 3 · 机器人写入**
  6. 绑定核销 + `/报名`、`/取消`、`/我的`，经可信后端写库。
- **阶段 4 · 通知与按钮**
  7. 报名 / 满员提醒、按钮交互（按平台能力推进）。

每个阶段可独立上线、可回滚；阶段 1 是其余阶段的前提。

## 10. 风险与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| OneBot 封号 | 第三方登录有风控 | 用小号；先只读；限频；随时可切官方 |
| 官方审核不确定 | 群聊能力 / 上线需审批 | 业务抽象成适配器，能力到位即切换 |
| QQ 互联备案门槛 | 个人 / 无备案域名受限 | 阶段一先用绑定码方案绕过 |
| 绑定被刷 | 恶意猜绑定码 | 一次性、5 分钟、限频、限群成员 |
| 密钥泄露 | service key 进前端 = 全库裸奔 | 密钥只在后端环境变量；前端只用 publishable |
| 身份伪造 | 冒充他人报名 | 一律以事件里的 QQ 号为身份，不以昵称 |

## 11. 需要你拍板的事

- 机器人先走 **NapCat（快、能力全、有封号风险）** 还是 **直接申请官方（稳、慢、能力受限）**？
- 后端用 **Supabase Edge Functions** 还是 **自建 Node 服务**（推荐后者，机器人需要常驻）？
- 有没有一台**常开服务器** + 一个可用的 **QQ 号（建议小号）**？
- 网站域名是否已**备案**（决定将来能否走官方 QQ 登录）？

## 12. 已确定的决策（2026-10-11）

| 事项 | 结论 |
| --- | --- |
| 机器人路线 | **NapCat（OneBot v11）**，先跑通只读；业务写成适配层，将来可切官方 |
| 后端形态 | **自建 Node 服务**，零依赖，跑在**用户本机**（非课题组 GPU 服务器） |
| 机器人 QQ 号 | 3931105615（建议确认是否为小号） |
| 通信方式 | NapCat「HTTP 上报」→ 本机 `127.0.0.1:8790/onebot`；本机调用 NapCat「HTTP API」发消息 |
| 网站托管 | **GitHub Pages**：https://senku1224.github.io/jiangcairobort/ （已上线，公开地址） |
| 数据库 | 仍为 Supabase；当前只读阶段机器人只用 publishable key，无需 service key |

机器人骨架代码见 `bot/`（`npm run bot`）。阶段 1（身份地基）尚未开始，需在 Supabase 侧执行新的 SQL 并接入匿名登录。
