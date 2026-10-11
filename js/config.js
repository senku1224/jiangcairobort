/* 公开运行配置。
 *
 * Supabase 的 Project URL 与 publishable（公开客户端）key 本就设计为可暴露给浏览器，
 * 放在这里没有安全问题；它只能访问被 RLS 允许的操作。
 *
 * ⚠️ 绝对不要在这个文件（或任何前端文件）里写入 secret key / service_role key。
 *    需要服务端密钥的操作必须放在真正的后端里，见 README「身份与权限」与「后续步骤」。
 */
window.GUILD_CONFIG = {
  supabaseUrl: 'https://cvuqgcuwfgpttgklkwiy.supabase.co',
  supabasePublishableKey: 'sb_publishable_89rNeFjm8oZHqOnWKbQKgg_DvjjvMH6'
};
