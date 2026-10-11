/* 后端选择。
 *
 * - 默认：如果配置了 Supabase（URL + publishable key）且客户端库已加载，就使用共享数据库。
 * - 连接失败时回退到本地 localStorage 演示模式，并把原因返回给界面，绝不假装已连上。
 * - 地址带 ?backend=local 时强制使用本地模式（自动化测试与离线体验用）。
 */
(function (root) {
  'use strict';

  function requestedBackend(search) {
    try { return new URLSearchParams(search || '').get('backend'); } catch { return null; }
  }

  async function createGuildService(options) {
    const { config, storage, location, clock } = options;
    const forceLocal = requestedBackend(location?.search) === 'local';
    const configured = Boolean(config?.supabaseUrl && config?.supabasePublishableKey);
    const library = root.supabase;

    const useLocal = async reason => {
      const service = root.GuildData.createService(storage, clock);
      await service.init();
      return { service, mode: 'local', reason };
    };

    if (forceLocal) return useLocal('按请求使用本地演示模式。');
    if (!configured) return useLocal('未配置 Supabase，使用本地演示模式。');
    if (!library || typeof library.createClient !== 'function') return useLocal('未能加载 Supabase 客户端，使用本地演示模式。');

    try {
      const client = library.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const service = root.GuildSupabase.createSupabaseService(client, storage, clock);
      await service.init();
      return { service, mode: 'supabase', reason: '已连接共享公会数据库。' };
    } catch (error) {
      return useLocal(`共享数据库连接失败（${error.message}），已回退到本地演示数据，暂时无法与群友同步。`);
    }
  }

  const api = { createGuildService };
  root.GuildBackend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
