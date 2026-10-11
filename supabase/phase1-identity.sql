-- 酱菜冒险者公会 · 阶段 1：身份地基
-- 用法：Supabase 控制台 → SQL Editor → 粘贴整段 → Run（只需跑一次）。
--
-- 前置条件：
--   1) 已在 Supabase 控制台开启 Authentication → Sign In / Providers → Anonymous sign-ins。
--   2) 建议在网页端已更新到「匿名登录」版本之后再执行本脚本（脚本会自动检查历史数据）。
--
-- 本脚本会：
--   · 新增 profiles / link_codes / groups 三张表
--   · 把 quests.owner_id、quest_members.user_id 从 text 改为 uuid（指向 auth.users）
--   · 把 RLS 从「人人可改」收紧为「只能改自己的」（依赖 auth.uid()）
--
-- 幂等：可重复执行。不会删除任何业务数据。

-- ============================================================ 0. 安全前置检查
-- 只有当历史数据的归属列"看起来像 uuid"时才允许转换，避免转换失败丢数据。
do $$
declare
  pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if exists (select 1 from public.quests where owner_id !~ pattern) then
    raise exception 'quests.owner_id 中存在非 uuid 的历史数据，请先处理后再执行本脚本。';
  end if;
  if exists (select 1 from public.quest_members where user_id !~ pattern) then
    raise exception 'quest_members.user_id 中存在非 uuid 的历史数据，请先处理后再执行本脚本。';
  end if;
end $$;

-- ============================================================ 1. 新增表
-- 冒险者档案：以 Supabase 匿名用户 id 为主键；QQ 号由可信后端（service key）写入
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null default '酱菜见习生'
             check (char_length(nickname) between 1 and 20),
  qq_number  text unique check (qq_number is null or qq_number ~ '^[0-9]{5,12}$'),
  bound_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 一次性绑定码：网页生成 → 用户发给 QQ 机器人 → 后端核销
create table if not exists public.link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null default 'qq',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  consumed_qq text
);
create index if not exists link_codes_user_idx on public.link_codes (user_id);

-- QQ 群白名单（仅服务端可写；网页端不涉及）
create table if not exists public.groups (
  group_id   text primary key check (group_id ~ '^[0-9]{5,12}$'),
  platform   text not null default 'qq',
  name       text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================ 2. 归属列改为 uuid
-- 先去掉旧的文本长度约束（uuid 不再适用）
alter table public.quests        drop constraint if exists quests_owner_id_check;
alter table public.quest_members drop constraint if exists quest_members_user_id_check;

-- text -> uuid（表为空，仅做类型变更）
alter table public.quests        alter column owner_id type uuid using owner_id::uuid;
alter table public.quest_members alter column user_id  type uuid using user_id::uuid;

-- 关联到 auth.users（用户被删除时，其委托与报名一并清理）
alter table public.quests        drop constraint if exists quests_owner_fk;
alter table public.quest_members drop constraint if exists quest_members_user_fk;
alter table public.quests
  add constraint quests_owner_fk
  foreign key (owner_id) references auth.users (id) on delete cascade;
alter table public.quest_members
  add constraint quest_members_user_fk
  foreign key (user_id) references auth.users (id) on delete cascade;

-- ============================================================ 3. 触发器
-- 3.1 报名规则（容量 / 是否已截止）——沿用原有逻辑，重新创建以确保存在
create or replace function public.enforce_member_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quest_capacity integer;
  quest_state    text;
  quest_start    timestamptz;
  member_count   integer;
begin
  select capacity, state, start_at
    into quest_capacity, quest_state, quest_start
    from public.quests
   where id = new.quest_id
   for update;

  if not found then
    raise exception '这份委托已不存在，请刷新列表。';
  end if;

  if quest_state <> 'open' or quest_start <= now() then
    raise exception '这份委托已截止，不能再修改报名。';
  end if;

  select count(*) into member_count
    from public.quest_members
   where quest_id = new.quest_id;

  if member_count >= quest_capacity then
    raise exception '队伍已满员，看看其他委托吧。';
  end if;

  return new;
end;
$$;

drop trigger if exists quest_members_rules on public.quest_members;
create trigger quest_members_rules
  before insert on public.quest_members
  for each row execute function public.enforce_member_rules();

-- 3.2 保护 profiles 的敏感列：QQ 号 / 绑定时间只能由服务端（service_role）写入
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_service boolean := coalesce(auth.role(), current_setting('request.jwt.claim.role', true)) = 'service_role';
begin
  if not is_service then
    if tg_op = 'INSERT' then
      new.qq_number := null;
      new.bound_at  := null;
    else
      if new.qq_number is distinct from old.qq_number
         or new.bound_at is distinct from old.bound_at then
        raise exception 'QQ 绑定关系只能由服务端写入。';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before insert or update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ============================================================ 4. Row Level Security
alter table public.quests        enable row level security;
alter table public.quest_members enable row level security;
alter table public.profiles      enable row level security;
alter table public.link_codes    enable row level security;
alter table public.groups        enable row level security;

-- ---------------------------------------------------------------- quests
-- 看板对所有人公开可读
drop policy if exists quests_select on public.quests;
create policy quests_select on public.quests for select using (true);

-- 发布：只能以自己的身份发布
drop policy if exists quests_insert on public.quests;
create policy quests_insert on public.quests
  for insert with check (auth.uid() = owner_id);

-- 结束 / 取消 / 改名：只能改自己的委托
drop policy if exists quests_update on public.quests;
create policy quests_update on public.quests
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id and state in ('open', 'ended', 'cancelled'));

-- 删除：自己的委托（或示例委托）
drop policy if exists quests_delete_demo on public.quests;
drop policy if exists quests_delete on public.quests;
create policy quests_delete on public.quests
  for delete using (auth.uid() = owner_id or is_demo = true);

-- ------------------------------------------------------------ quest_members
-- 报名名单对所有访问者公开
drop policy if exists members_select on public.quest_members;
create policy members_select on public.quest_members for select using (true);

-- 报名：只能报自己
drop policy if exists members_insert on public.quest_members;
create policy members_insert on public.quest_members
  for insert with check (auth.uid() = user_id);

-- 改名同步：只能改自己的报名记录
drop policy if exists members_update on public.quest_members;
create policy members_update on public.quest_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 退出报名：只能删自己的报名记录
drop policy if exists members_delete on public.quest_members;
create policy members_delete on public.quest_members
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- profiles
-- 昵称对已登录（含匿名登录）用户可见；QQ 号不对外暴露给未登录访问者
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- -------------------------------------------------------------- link_codes
-- 网页端只能创建 / 查看 / 作废自己的绑定码；核销由服务端完成
drop policy if exists link_codes_insert on public.link_codes;
create policy link_codes_insert on public.link_codes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists link_codes_select on public.link_codes;
create policy link_codes_select on public.link_codes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists link_codes_delete on public.link_codes;
create policy link_codes_delete on public.link_codes
  for delete to authenticated using (auth.uid() = user_id and consumed_at is null);

-- ---------------------------------------------------------------- groups
-- 不给任何策略：只有服务端（service key，绕过 RLS）能读写群白名单
drop policy if exists groups_deny_all on public.groups;

-- ============================================================ 5. 完成提示
do $$
begin
  raise notice '阶段 1 完成：profiles / link_codes / groups 已就绪，归属列已改为 uuid，RLS 已收紧。';
end $$;
