-- 酱菜冒险者公会 · Supabase 数据库结构
-- 用法：Supabase 控制台 → SQL Editor → 粘贴整段 → Run。
-- 幂等：可重复执行，不会删除既有数据。

-- ---------------------------------------------------------------- 表
create table if not exists public.quests (
  id             text primary key,
  game           text not null check (char_length(game) between 1 and 40),
  owner_id       text not null check (char_length(owner_id) between 1 and 64),
  owner_nickname text not null check (char_length(owner_nickname) between 1 and 20),
  start_at       timestamptz not null,
  created_at     timestamptz not null default now(),
  capacity       integer not null check (capacity between 1 and 32),
  voice          text not null check (voice in ('any', 'required', 'none')),
  note           text not null default '' check (char_length(note) <= 500),
  state          text not null default 'open' check (state in ('open', 'ended', 'cancelled')),
  is_demo        boolean not null default false
);

create index if not exists quests_start_at_idx   on public.quests (start_at);
create index if not exists quests_created_at_idx on public.quests (created_at desc);

create table if not exists public.quest_members (
  quest_id   text not null references public.quests (id) on delete cascade,
  user_id    text not null check (char_length(user_id) between 1 and 64),
  nickname   text not null check (char_length(nickname) between 1 and 20),
  created_at timestamptz not null default now(),
  primary key (quest_id, user_id)
);

create index if not exists quest_members_quest_idx on public.quest_members (quest_id);

-- ------------------------------------------------- 服务端规则：容量与时间
-- 报名写入前，在数据库层再校验一次「委托是否仍开放 / 是否已满」，
-- 这样即使有人绕过前端直接请求，也无法给已截止的委托报名或造成超员。
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

-- ------------------------------------------------------- Row Level Security
alter table public.quests        enable row level security;
alter table public.quest_members enable row level security;

-- 读取：公会看板对所有访问者公开
drop policy if exists quests_select on public.quests;
create policy quests_select on public.quests for select using (true);

drop policy if exists members_select on public.quest_members;
create policy members_select on public.quest_members for select using (true);

-- 发布委托：字段取值范围由表上的 check 约束兜底
drop policy if exists quests_insert on public.quests;
create policy quests_insert on public.quests for insert with check (true);

-- 报名：容量与时间由 enforce_member_rules 触发器负责
drop policy if exists members_insert on public.quest_members;
create policy members_insert on public.quest_members for insert with check (true);

-- 退出报名：允许删除报名记录
-- ⚠️ 未接入登录前，数据库无法判断「这条报名是不是本人的」，见 README「身份与权限」。
drop policy if exists members_delete on public.quest_members;
create policy members_delete on public.quest_members for delete using (true);

-- 修改报名昵称（改名时同步）
drop policy if exists members_update on public.quest_members;
create policy members_update on public.quest_members for update using (true) with check (true);

-- 修改委托：用于结束/取消招募、同步发布者昵称
-- ⚠️ 同上，未登录时数据库无法校验归属；前端会带上 owner_id 条件做尽力限制。
drop policy if exists quests_update on public.quests;
create policy quests_update on public.quests
  for update using (true)
  with check (state in ('open', 'ended', 'cancelled'));

-- 删除委托：只允许删除示例委托；其他委托无法被匿名删除
drop policy if exists quests_delete_demo on public.quests;
create policy quests_delete_demo on public.quests for delete using (is_demo = true);
