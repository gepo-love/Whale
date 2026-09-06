/**
 * 小手机 · 更新确认器（独立于 bundle，永远最新）
 * 策略：SW 缓存优先——用户不点「立即更新」就一直跑旧版本，数据原封不动。
 * 本文件：页面加载时检查服务器构建版本，发现新版本时弹全屏确认页。
 *  - 立即更新：清空 SW 缓存 + 刷新 → 拿到新版本
 *  - 暂不更新：记录已接受，继续用旧版，这个版本不再打扰
 * 部署新版本时：改 UPDATE_NOTES 公告文案 + bump build.js VERSION。
 */
(function() {
  'use strict';

  var ACCEPTED_KEY = 'littlephone_accepted_build_version';
  var UPDATE_NOTES = {
    date: '2026-08-24',
    title: '今日更新',
    features: [
      '☁️ 云备份新增 Gitee 直连：备份存进你自己的私有仓库',
      '🎨 应用商城上线：发布你的美化主题，一键导入别人做的',
      '☁️ 云备份修好：坚果云/TeraCloud 可以用了',
      '🐾 用户小号改版：开局陌生视角，角色靠蛛丝马迹慢慢猜',
      '✍️ 创建小号用弹窗填身份，角色打勾多选',
      '📖 单独线下聊天读全文，AI 不再断片',
      '🖼️ 沙盒和线下也能用聊天背景',
      '📱 查手机改为智能抽查（聊天必查 + 随机 3 项）',
      '🎙️ 语音带情绪标记，文字消息也能播放语音',
      '✨ 还有很多优化小细节不写了'
    ]
  };
  var _shown = false;

  function escHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ★ 带随机参数请求：绕过 SW 缓存，一定拿到服务器最新版本号
  function fetchBuildVersion() {
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) { return (data && data.version) ? String(data.version) : null; })
      .catch(function() { return null; });
  }

  function recordAccepted(version) {
    try { localStorage.setItem(ACCEPTED_KEY, version); } catch (e) {}
  }

  function showConfirm(buildVersion) {
    if (_shown) return;
    _shown = true;
    var overlay = document.createElement('div');
    overlay.id = 'updateConfirmOverlay';
    overlay.className = 'update-confirm-overlay';
    overlay.innerHTML =
      '<div class="update-confirm-dialog">' +
        '<div class="update-confirm-head">' +
        '<svg class="update-confirm-whale" viewBox="0 0 100 60" width="96" height="58" xmlns="http://www.w3.org/2000/svg">' +
          '<rect class="uc-spout-dot" x="38" y="4" width="4" height="7" rx="1.5" fill="#b8d8e8"/>' +
          '<rect class="uc-spout-dot" x="34" y="7" width="3" height="5" rx="1" fill="#c8e4f0"/>' +
          '<rect class="uc-spout-dot" x="42" y="6" width="3" height="5" rx="1" fill="#c8e4f0"/>' +
          '<g class="uc-whale-tail">' +
            '<rect x="2" y="22" width="10" height="6" rx="2" fill="#6a9ab5"/>' +
            '<rect x="0" y="18" width="6" height="5" rx="1.5" fill="#5d8da8"/>' +
            '<rect x="0" y="27" width="6" height="5" rx="1.5" fill="#5d8da8"/>' +
          '</g>' +
          '<rect x="12" y="16" width="44" height="18" rx="8" fill="#8FAFBF"/>' +
          '<rect x="8" y="18" width="10" height="14" rx="5" fill="#7a9fb0"/>' +
          '<rect x="20" y="28" width="28" height="6" rx="3" fill="#c8e0eb"/>' +
          '<circle cx="48" cy="22" r="5" fill="#fff"/>' +
          '<circle cx="49" cy="22" r="2.5" fill="#3a5060"/>' +
          '<circle cx="50" cy="21" r="1" fill="#fff"/>' +
          '<rect x="24" y="32" width="8" height="4" rx="2" fill="#6a9ab5"/>' +
          '<rect x="40" y="30" width="8" height="2" rx="1" fill="#6a9ab5"/>' +
          '<rect x="42" y="32" width="2" height="2" rx="1" fill="#6a9ab5"/>' +
        '</svg>' +
        '<div class="update-confirm-title">' + escHtml(UPDATE_NOTES.title) + '</div>' +
          '<div class="update-confirm-date">' + escHtml(UPDATE_NOTES.date) + '</div>' +
        '</div>' +
        '<div class="update-confirm-body">' +
          '<ul class="update-confirm-list">' +
            UPDATE_NOTES.features.map(function(f) { return '<li>' + escHtml(f) + '</li>'; }).join('') +
          '</ul>' +
        '</div>' +
        '<div class="update-confirm-actions">' +
          '<button class="update-confirm-btn update-confirm-secondary" id="updateSkipBtn">暂不更新</button>' +
          '<button class="update-confirm-btn update-confirm-primary" id="updateApplyBtn">立即更新</button>' +
        '</div>' +
      '</div>';

    var style = document.createElement('style');
    style.id = 'updateConfirmStyles';
    style.textContent =
      '.update-confirm-overlay { position:fixed; top:0; left:0; right:0; bottom:0; z-index:999998; background:rgba(61,79,92,0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:20px; }' +
      '.update-confirm-dialog { background:var(--surface-card,#fff); border-radius:var(--radius-xl,28px); width:100%; max-width:480px; max-height:85vh; overflow:hidden; box-shadow:var(--shadow-float-lg,0 8px 32px rgba(100,120,135,0.12)); animation:update-confirm-in 0.3s cubic-bezier(0.34,1.56,0.64,1); }' +
      '@keyframes update-confirm-in { from { transform:scale(0.9); opacity:0; } to { transform:scale(1); opacity:1; } }' +
      '.update-confirm-head { padding:26px 24px 18px; text-align:center; background:linear-gradient(180deg,rgba(143,175,191,0.10) 0%,transparent 100%); border-bottom:1px solid var(--border-light,rgba(0,0,0,0.05)); }' +
      '.update-confirm-whale { display:block; margin:0 auto 10px; animation:uc-whale-bob 2.4s ease-in-out infinite; transform-origin:center center; }' +
      '.uc-whale-tail { animation:uc-whale-tail 1.8s ease-in-out infinite; transform-origin:4px 28px; }' +
      '.uc-spout-dot { animation:uc-whale-spout 1.2s ease-in-out infinite; }' +
      '.uc-spout-dot:nth-child(2) { animation-delay:0.15s; }' +
      '.uc-spout-dot:nth-child(3) { animation-delay:0.3s; }' +
      '@keyframes uc-whale-bob { 0%,100% { transform:translateY(0) rotate(0deg); } 25% { transform:translateY(-6px) rotate(-1.5deg); } 75% { transform:translateY(4px) rotate(1.5deg); } }' +
      '@keyframes uc-whale-tail { 0%,100% { transform:rotate(0deg); } 50% { transform:rotate(8deg); } }' +
      '@keyframes uc-whale-spout { 0%,100% { opacity:0.4; transform:translateY(0) scale(1); } 50% { opacity:1; transform:translateY(-4px) scale(1.3); } }' +
      '.update-confirm-title { font-size:22px; font-weight:600; color:var(--ink,#3D4F5C); margin-bottom:4px; }' +
      '.update-confirm-date { font-size:12px; color:var(--ink-subtle,#A0B4C2); }' +
      '.update-confirm-body { padding:18px 24px; max-height:55vh; overflow-y:auto; }' +
      '.update-confirm-list { list-style:none; padding:0; margin:0; }' +
      '.update-confirm-list li { padding:8px 0 8px 22px; font-size:14px; line-height:1.6; color:var(--ink-light,#7D93A2); position:relative; }' +
      '.update-confirm-list li::before { content:"·"; position:absolute; left:8px; color:var(--monet-blue,#8FAFBF); font-size:20px; font-weight:bold; }' +
      '.update-confirm-actions { padding:14px 24px calc(14px + var(--sab,0px)); display:flex; gap:12px; border-top:1px solid var(--border-light,rgba(0,0,0,0.05)); }' +
      '.update-confirm-btn { flex:1; height:46px; border-radius:var(--radius-md,16px); border:none; font-size:15px; font-weight:600; cursor:pointer; font-family:var(--font,inherit); }' +
      '.update-confirm-secondary { background:transparent; color:var(--ink-light,#7D93A2); border:1px solid var(--border-light,rgba(0,0,0,0.05)); }' +
      '.update-confirm-primary { background:var(--monet-blue,#8FAFBF); color:#fff; box-shadow:0 4px 14px rgba(143,175,191,0.35); }' +
      '.update-confirm-primary:active { transform:translateY(1px); }';

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    document.getElementById('updateSkipBtn').addEventListener('click', function() {
      recordAccepted(buildVersion);
      overlay.remove();
    });
    document.getElementById('updateApplyBtn').addEventListener('click', function() {
      applyUpdate(buildVersion, overlay);
    });
  }

  function applyUpdate(buildVersion, overlay) {
    recordAccepted(buildVersion);
    if (overlay) overlay.remove();
    // ★ 通知 SW 清空全部缓存；有 waiting 的新 SW 则跳过等待
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'apply_update' });
      }
    } catch (e) {}
    // 等 600ms 让 SW 清完缓存，再带随机参数刷新（绕过缓存必拿新版本）
    setTimeout(function() {
      try { window.location.href = 'index.html?updated=' + Date.now(); } catch (e) { try { window.location.reload(); } catch (e2) {} }
    }, 600);
  }

  function init() {
    // 本地开发：跳过确认流程
    try {
      var host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') return;
    } catch (e) {}

    // 无 SW（首次访问/无缓存环境）：页面本身就是最新，静默记录已接受
    var hasSW = false;
    try { hasSW = !!('serviceWorker' in navigator && navigator.serviceWorker.controller); } catch (e) {}

    fetchBuildVersion().then(function(build) {
      if (!build) return;
      try {
        if (localStorage.getItem(ACCEPTED_KEY) === build) return; // 这个版本已处理过
      } catch (e) {}
      if (!hasSW) { recordAccepted(build); return; } // 无缓存环境无需确认
      showConfirm(build);
    });
  }

  // bundle 在 body 末尾加载，这里直接检查（不用等 DOMContentLoaded，反正 appendChild 到 body 会排队）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
