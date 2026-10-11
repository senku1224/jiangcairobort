/* 机器人后端配置。
 *
 * 零依赖：只用 Node 内置模块。优先读取 bot/.env（若存在），其次读环境变量，最后用默认值。
 *
 * ⚠️ 密钥边界：
 *   - SUPABASE_KEY 用公开的 publishable key，只能读被 RLS 允许的数据（当前阶段够用）。
 *   - SUPABASE_SERVICE_KEY 是服务端密钥，只能放在本机 bot/.env（已被 .gitignore 忽略），
 *     绝不要写进前端、仓库或聊天里。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envFile); } catch { /* 忽略解析错误，回退到环境变量 */ }
  } else {
    // Node < 20.12 的兜底解析
    try {
      for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
        if (match && !line.trimStart().startsWith('#')) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* 忽略 */ }
  }
}

const env = process.env;

function list(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

const config = {
  // OneBot / NapCat
  onebotApi: env.ONEBOT_API || 'http://127.0.0.1:3000',
  onebotToken: env.ONEBOT_TOKEN || '',
  listenPort: Number(env.BOT_PORT || 8790),
  listenPath: env.BOT_PATH || '/onebot',
  // 只在这些群响应；为空表示所有群都响应
  allowedGroups: list(env.ALLOWED_GROUPS),
  commandPrefix: env.COMMAND_PREFIX || '',
  // Supabase
  supabaseUrl: env.SUPABASE_URL || 'https://cvuqgcuwfgpttgklkwiy.supabase.co',
  supabaseKey: env.SUPABASE_KEY || 'sb_publishable_89rNeFjm8oZHqOnWKbQKgg_DvjjvMH6',
  supabaseServiceKey: env.SUPABASE_SERVICE_KEY || '',
  siteUrl: env.SITE_URL || 'https://senku1224.github.io/jiangcairobort/'
};

function isGroupAllowed(groupId) {
  if (!config.allowedGroups.length) return true;
  return config.allowedGroups.includes(String(groupId));
}

module.exports = { config, isGroupAllowed };
