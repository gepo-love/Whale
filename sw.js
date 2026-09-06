/**
 * 小手机 Service Worker
 * 策略：全部缓存优先——用户不点「立即更新」就一直用旧版本。
 * 更新：update-check.js 弹确认页 → 用户点立即更新 → apply_update 清缓存 + 刷新。
 * 本地开发（localhost）：网络优先，改代码即时生效。
 */

const CACHE_NAME = 'littlephone-v405-20260904-selector-sheet-proactive-context';

// ★ 只预缓存「确认存在」的静态资源（dev 和 prod 共有）
//   JS 文件不预缓存——prod 只有一个 obf 大包，路径不同
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './css/phone.css',
  './css/chat.css',
  './css/desktop-cards.css',
  './css/emoji.css',
  './css/settings.css',
  './css/moments.css',
  './css/theme.css',
  './css/toolbox.css',
  './css/games.css',
  './css/mall.css',
  './css/secondhand.css',
  './css/driftbottle.css',
  './css/fantasy.css',
  './css/watch.css',
  './css/listentogether.css',
  './css/pomodoro.css',
  './css/forum.css',
  './css/call.css',
  './css/home.css',
  './css/calendar.css',
  './css/memoryapp.css',
  './css/group-cards.css',
  './css/floating-ball.css',
  './css/mcp.css',
  './css/fanfic.css',
  './css/diary.css',
];

// 关键资源：任一个预缓存失败 → 安装失败 → 旧 SW 继续接管
const CRITICAL_ASSETS = new Set([
  './',
  './index.html',
  './css/phone.css',
  './css/chat.css',
]);

// ═══════════════ 安装：只预缓存关键小文件 ═══════════════

self.addEventListener('install', (event) => {
  console.log('[SW] 安装中... CACHE_NAME=' + CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const tasks = STATIC_ASSETS.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[SW] 预缓存失败:', url, err.message || err);
          return { _failed: true, url: url };
        })
      );
      return Promise.all(tasks).then((results) => {
        const failed = results.filter((r) => r && r._failed);
        if (failed.length > 0) {
          console.warn('[SW] ' + failed.length + ' 个文件预缓存失败:', failed.map((f) => f.url).join(', '));
        }
        const criticalFailed = failed.filter((f) => CRITICAL_ASSETS.has(f.url));
        if (criticalFailed.length > 0) {
          throw new Error('[SW] 关键资源预缓存失败，拒绝激活: ' + criticalFailed.map((f) => f.url).join(', '));
        }
        console.log('[SW] 预缓存完成，共 ' + (STATIC_ASSETS.length - failed.length) + '/' + STATIC_ASSETS.length + ' 个文件');
      });
    })
    // ★ 安装完成后通知所有客户端「新版本可用」
    .then(() => {
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'sw_installed', version: CACHE_NAME });
        });
      });
    })
  );
});

// ═══════════════ 激活：强制清旧缓存（2026-08-31 闪退事故） ═══════════════

self.addEventListener('activate', (event) => {
  // ★ 2026-08-31 强制更新：v340/v341 强混淆 6MB 包让用户首启闪退，而 cacheFirst
  //   会把旧 bundle 写进缓存——闪退用户打不开页面点不到「立即更新」，永远啃旧包死循环。
  //   改为激活时删除所有旧 CACHE_NAME 缓存，下次打开直接网络拉新版（v342 轻包）。
  //   闪退用户进程被杀 = 旧 SW 死亡，新 SW 立即上位清缓存，最多多打开一次就能获救。
  console.log('[SW] 激活，删除所有旧版本缓存（强制更新到 ' + CACHE_NAME + '）');
  event.waitUntil(
    caches.keys().then((keys) => {
      const deletes = keys.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] 删除旧缓存:', key);
          return caches.delete(key);
        }
        return Promise.resolve(false);
      });
      return Promise.all(deletes);
    }).then(() => self.clients.claim()).then(() => {
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'sw_updated', version: CACHE_NAME });
        });
      });
    })
  );
});

// ═══════════════ 请求拦截 ═══════════════

self.addEventListener('fetch', (event) => {
  // 只处理 GET
  if (event.request.method !== 'GET') return;

  // 跳过 API 请求（★ 2026-09-03 修：/music/ 之前漏了——登录状态/播放链接被 SW 缓存，
  // 导致"歌单不出现 + 播放链接过期重取仍失效"，API 一律网络直连）
  const url = event.request.url;
  if (url.includes('/v1/') || url.includes('/api/') || url.includes('/auth/') || url.includes('/music/')) return;

  // 跳过测试路径（/test/ 有独立服务，不参与主站缓存）
  if (url.includes('/test/')) return;

  // 跳过非 http 请求
  if (!url.startsWith('http')) return;

  // 跳过 chrome-extension
  if (url.startsWith('chrome-extension://')) return;

  // ── 本地开发例外：localhost 总是网络优先，改代码即时生效 ──
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      event.respondWith(networkFirst(event.request));
      return;
    }
  } catch (e) {}

  // ── 策略：全部缓存优先 ──
  // ★ 用户不点「立即更新」就一直用旧版本（更新由 update-check.js 的确认页驱动）。
  // 点更新后：清缓存 + reload → cacheFirst 不命中 → 网络拿新版本。
  event.respondWith(cacheFirst(event.request));
});

// ═══════════════ 策略函数 ═══════════════

/** 网络优先：先试网络，失败才用缓存（用于 HTML 和 JS） */
async function networkFirst(request, options) {
  const timeoutMs = options && options.timeoutMs ? Number(options.timeoutMs) : 0;
  const cachedPromise = caches.match(request);
  const networkPromise = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  });

  try {
    if (timeoutMs > 0) {
      const timeoutFallback = new Promise((resolve) => {
        setTimeout(async () => {
          resolve((await cachedPromise) || null);
        }, timeoutMs);
      });
      const first = await Promise.race([networkPromise, timeoutFallback]);
      if (first) return first;
    }
    return await networkPromise;
  } catch (e) {
    // 网络失败 → 尝试缓存
    const cached = await cachedPromise;
    if (cached) return cached;
    // 完全没有 → 返回离线页
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('./app.html');
      if (offlinePage) return offlinePage;
    }
    throw e;
  }
}

/** 纯缓存优先：命中缓存直接返回；不命中才走网络并写缓存（用户点更新前一直用旧版） */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

// ═══════════════ 桌面通知 ═══════════════

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'showNotification') {
    const { title, body, icon, badge, tag, url } = event.data;
    self.registration.showNotification(title, {
      body: body || '',
      icon: icon || './icon-192.png',
      badge: badge || './icon-192.png',
      tag: tag || 'littlephone-msg',
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
      data: { url: url || '/' }
    });
  }

  // ★ 页面主动请求 skipWaiting（用户点了「刷新更新」按钮）
  if (event.data && event.data.type === 'skip_waiting') {
    self.skipWaiting();
  }

  // ★ 用户确认更新：清掉全部缓存（旧版本退役），有 waiting 的新 SW 则跳过等待
  if (event.data && event.data.type === 'apply_update') {
    event.waitUntil((async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        console.log('[SW] 用户确认更新，已清空缓存:', keys.join(', '));
      } catch (e) { console.warn('[SW] 清缓存失败:', e); }
      try {
        const reg = await self.registration;
        if (reg.waiting) reg.waiting.postMessage({ type: 'skip_waiting' });
      } catch (e) {}
    })());
  }
});

// ═══════════════ Web Push ═══════════════

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch(e) {}

  if (payload.type === 'life_tick') {
    event.waitUntil(handleLifeTickPush(payload));
  } else if (payload.type === 'proactive') {
    event.waitUntil(handleProactivePush());
  }
});

const DB_NAME = 'LittlePhoneDB';
const DB_VERSION = 10;

/** ★ 构建 OpenAI 兼容端点 */
function buildOpenAICompatibleEndpoint(rawUrl, endpointPath) {
  var endpoint = String(endpointPath || '').replace(/^\/+/, '');
  var base0 = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!base0) return '';

  var knownEndpoints = [
    'chat/completions',
    'images/generations',
    'images/edits',
    'embeddings',
    'models'
  ];
  var base = base0;
  var lower0 = base0.toLowerCase();
  for (var i = 0; i < knownEndpoints.length; i++) {
    var suffix = '/' + knownEndpoints[i];
    if (lower0.endsWith(suffix)) {
      base = base0.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }

  var endpointLower = endpoint.toLowerCase();
  if (lower0.endsWith('/' + endpointLower)) return base0;
  if (base.toLowerCase().endsWith('/v1')) return base + '/' + endpoint;
  return base + '/' + endpoint;
}

/** ★ 写主动消息日志到 IndexedDB */
function writeSWProactiveLog(db, friendId, msgContent, timestamp) {
  return idbGetSetting(db, 'littlephone_proactive_sw_log', { entries: [] }).then(function(log) {
    try {
      if (!log || typeof log !== 'object' || Array.isArray(log)) {
        log = { entries: [] };
      }
      log._updatedAt = timestamp;
      var found = false;
      var entries = log.entries || [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].friendId === friendId) {
          entries[i].lastProactiveAt = timestamp;
          entries[i].count = (entries[i].count || 0) + 1;
          entries[i]._swGenerated = true;
          found = true;
          break;
        }
      }
      if (!found) {
        entries.push({
          friendId: friendId,
          lastProactiveAt: timestamp,
          count: 1,
          _swGenerated: true
        });
      }
      if (entries.length > 20) entries = entries.slice(-20);
      log.entries = entries;
      return idbSetSetting(db, 'littlephone_proactive_sw_log', log);
    } catch(e) {}
  });
}

async function handleProactivePush() {
  var db = null;
  try {
    db = await openIDB();
    if (!db) return;

    var apiSettings = await idbGet(db, 'apiSettings', 'main');
    var chatConfig = (apiSettings && apiSettings.configs && apiSettings.configs.chat) || {};
    if (!chatConfig.url || !chatConfig.key) return;
    var chatUrl = buildOpenAICompatibleEndpoint(chatConfig.url, 'chat/completions');
    if (!chatUrl) return;

    var proactiveSettings = await idbGetSetting(db, 'proactiveSettings', null);
    if (!proactiveSettings || !proactiveSettings.enabled || !proactiveSettings.roleIds) return;
    var roleIds = proactiveSettings.roleIds || [];
    if (!roleIds.length) return;

    var shuffled = roleIds.slice().sort(function() { return Math.random() - 0.5; });
    var success = false;

    for (var i = 0; i < shuffled.length; i++) {
      var friendId = shuffled[i];
      var friend = await idbGet(db, 'friends', friendId);
      if (!friend) continue;

      var blockedList = await idbGetSetting(db, 'littlephone_blocked_friends', []);
      if (blockedList && Array.isArray(blockedList)) {
        if (blockedList.some(function(b) { return b.friendId === friendId; })) continue;
      }

      var timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      var charName = friend.remark || friend.name || '角色';
      var roleText = (friend.role || '').substring(0, 1500);
      var systemPrompt = '你是' + charName + '。\n【人设】\n' + roleText + '\n\n【当前时间】' + timeStr + '\n\n你现在想主动给用户发一条消息。像真人一样自然随意——想到什么说什么，可以分享当下的心情、看到的东西、或者突然想到的事。20-60字，纯对话。';

      try {
        var requestBody = {
          model: chatConfig.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '（主动发一条消息给对方）' }
          ],
          temperature: 0.85
        };
        if (Number(chatConfig.maxTokens) > 0) requestBody.max_tokens = Number(chatConfig.maxTokens);
        var response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + chatConfig.key
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) continue;
        var data = await response.json();
        var reply = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
        if (!reply) continue;

        var msgId = 'sw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        var now = new Date().toISOString();
        var msg = {
          id: msgId,
          type: 'received',
          content: reply,
          contentType: 'text',
          batchFirst: true,
          timestamp: now,
          senderId: friend.id,
          _proactive: true
        };

        await swAddMessage(db, friend.id, msg);

        var unread = (friend.unreadCount || 0) + 1;
        var updatedFriend = {};
        Object.keys(friend).forEach(function(k) { updatedFriend[k] = friend[k]; });
        updatedFriend.lastMessage = reply.substring(0, 50);
        updatedFriend.lastMessageTime = now;
        updatedFriend.unreadCount = unread;
        updatedFriend.pendingAiReply = 0;
        await idbPut(db, 'friends', updatedFriend);

        await writeSWProactiveLog(db, friend.id, reply, now);

        await self.registration.showNotification(charName, {
          body: reply.substring(0, 80),
          icon: friend.avatarImage || './icon-192.png',
          badge: './icon-192.png',
          tag: 'proactive-' + friend.id,
          renotify: true,
          vibrate: [200, 100, 200],
          data: { url: './?chat=' + friend.id }
        });

        success = true;
        break;
      } catch(e) {
        console.warn('[SW主动消息] AI调用失败:', e.message);
      }
    }

  } catch(e) {
    console.error('[SW主动消息] 整体流程失败:', e);
  } finally {
    try { if (db) db.close(); } catch(e2) {}
  }
}

// ═══════════════ Web Push：生活引擎闹钟 ═══════════════

async function handleLifeTickPush(payload) {
  var db = null;
  try {
    db = await openIDB();
    if (!db) return;

    var proactiveSettings = await idbGetSetting(db, 'proactiveSettings', null);
    if (!proactiveSettings || !proactiveSettings.enabled || !proactiveSettings.roleIds || !proactiveSettings.roleIds.length) {
      db.close(); return;
    }
    var roleIds = proactiveSettings.roleIds;
    var caps = { quiet: 3, natural: 6, active: 10 };
    var dailyCap = caps[proactiveSettings.frequency] || 6;

    var now = new Date();
    var today = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    var pendingTicks = [];
    var hasNewContent = false;

    for (var i = 0; i < roleIds.length; i++) {
      var charId = roleIds[i];

      var eventStats = await new Promise(function(resolve) {
        try {
          var tx = db.transaction('lifeEvents', 'readonly');
          var store = tx.objectStore('lifeEvents');
          var index = store.index('characterId_date');
          var range = IDBKeyRange.only([charId, today]);
          var actionCount = 0;
          var latestAt = '';
          var req = index.openCursor(range);
          req.onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) {
              var value = cursor.value || {};
              if (value.status === 'done' &&
                  value.type !== 'catchup' &&
                  value.type !== 'inner_thought' &&
                  value.type !== 'skip') {
                actionCount++;
              }
              if (value.triggeredAt && value.triggeredAt > latestAt) latestAt = value.triggeredAt;
              cursor.continue();
            } else {
              resolve({ count: actionCount, latestAt: latestAt });
            }
          };
          req.onerror = function() { resolve({ count: 0, latestAt: '' }); };
        } catch(e) { resolve({ count: 0, latestAt: '' }); }
      });

      var latestMs = eventStats.latestAt ? new Date(eventStats.latestAt).getTime() : 0;
      var cooldownPassed = !latestMs || (now.getTime() - latestMs) > 45 * 60000;

      if (eventStats.count < dailyCap && cooldownPassed) {
        hasNewContent = true;
        pendingTicks.push({
          characterId: charId,
          reason: eventStats.count === 0 ? '今天还没有生活事件' : '后台有可补算的生活时段',
          createdAt: now.toISOString()
        });
        break;
      }
    }

    if (pendingTicks.length > 0) {
      var existingPending = await idbGetSetting(db, 'pendingLifeTick', []);
      var existingIds = new Set();
      if (Array.isArray(existingPending)) {
        existingPending.forEach(function(t) { if (t && t.characterId) existingIds.add(t.characterId); });
      }

      var newTicks = pendingTicks.filter(function(t) { return !existingIds.has(t.characterId); });
      if (newTicks.length > 0) {
        var merged = (Array.isArray(existingPending) ? existingPending : []).concat(newTicks);
        if (merged.length > 5) merged = merged.slice(-5);
        await idbSetSetting(db, 'pendingLifeTick', merged);

        var body = '角色可能有新动态，打开看看吧';
        if (newTicks.length === 1) {
          try {
            var friend = await idbGet(db, 'friends', newTicks[0].characterId);
            if (friend) body = (friend.remark || friend.name || '角色') + '好像有新的动态';
          } catch(e) {}
        }

        self.registration.showNotification('🐋 鲸鱼机', {
          body: body,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: 'life-tick',
          renotify: true,
          vibrate: [100, 50, 100],
          data: { url: './' }
        });
      }
    }

    db.close();
  } catch(e) {
    console.warn('[SW life_tick] 失败:', e.message);
    try { if (db) db.close(); } catch(e2) {}
  }
}

// ═══════════════ IndexedDB 工具函数 ═══════════════

function openIDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('friends')) db.createObjectStore('friends', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'friendId' });
      if (!db.objectStoreNames.contains('messageItems')) {
        const msgStore = db.createObjectStore('messageItems', { keyPath: 'storeId' });
        msgStore.createIndex('friendId', 'friendId', { unique: false });
        msgStore.createIndex('friend_seq', ['friendId', '_seq'], { unique: false });
      }
      if (!db.objectStoreNames.contains('messageFavorites')) {
        const mfStore = db.createObjectStore('messageFavorites', { keyPath: 'id' });
        mfStore.createIndex('friendId', 'friendId', { unique: false });
        mfStore.createIndex('createdAt', 'createdAt', { unique: false });
        mfStore.createIndex('friend_msg', ['friendId', 'msgId'], { unique: true });
      }
      if (!db.objectStoreNames.contains('apiSettings')) db.createObjectStore('apiSettings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('worldBooks')) db.createObjectStore('worldBooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('worldBookFolders')) db.createObjectStore('worldBookFolders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('memories')) {
        const store = db.createObjectStore('memories', { keyPath: 'id' });
        store.createIndex('friendId', 'friendId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('moments')) {
        const store = db.createObjectStore('moments', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('appSettings')) db.createObjectStore('appSettings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('callHistory')) db.createObjectStore('callHistory', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('stickerGroups')) db.createObjectStore('stickerGroups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('stickers')) db.createObjectStore('stickers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tools')) {
        const store = db.createObjectStore('tools', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('homeMemories')) {
        const store = db.createObjectStore('homeMemories', { keyPath: 'id' });
        store.createIndex('characterId', 'characterId', { unique: false });
        store.createIndex('time', 'time', { unique: false });
      }
      if (!db.objectStoreNames.contains('fantasyNovels')) {
        const store = db.createObjectStore('fantasyNovels', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('tab', 'tab', { unique: false });
      }
      if (!db.objectStoreNames.contains('lifeEvents')) {
        const leStore = db.createObjectStore('lifeEvents', { keyPath: 'id' });
        leStore.createIndex('characterId', 'characterId', { unique: false });
        leStore.createIndex('date', 'date', { unique: false });
        leStore.createIndex('characterId_date', ['characterId', 'date'], { unique: false });
        leStore.createIndex('triggeredAt', 'triggeredAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('npcChats')) {
        const ncStore = db.createObjectStore('npcChats', { keyPath: 'id' });
        ncStore.createIndex('ownerId', 'ownerId', { unique: false });
        ncStore.createIndex('owner_peer', ['ownerId', 'peerId'], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch(e) { resolve(null); }
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = (e) => reject(e.target.error);
    } catch(e) { reject(e); }
  });
}

function idbGetSetting(db, key, defaultValue) {
  return idbGet(db, 'appSettings', key).then((record) => {
    return record && Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : defaultValue;
  });
}

function idbSetSetting(db, key, value) {
  return idbPut(db, 'appSettings', { key: key, value: value });
}

function swMessageStoreId(friendId, msgId) {
  return encodeURIComponent(String(friendId)) + '::' + encodeURIComponent(String(msgId));
}

async function swAddMessage(db, friendId, msg) {
  if (db.objectStoreNames.contains('messageItems')) {
    var seqKey = 'messages_v9_seq_' + friendId;
    var seq = Number(await idbGetSetting(db, seqKey, 0));
    if (!Number.isFinite(seq)) seq = 0;
    await idbSetSetting(db, seqKey, seq + 1);
    var legacy = await idbGet(db, 'messages', friendId);
    var legacyHasMessages = legacy && Array.isArray(legacy.messages) && legacy.messages.length > 0;
    if (!legacyHasMessages) await idbSetSetting(db, 'messages_v9_migrated_' + friendId, true);
    await idbPut(db, 'messageItems', Object.assign({}, msg, {
      friendId: friendId,
      storeId: swMessageStoreId(friendId, msg.id),
      _seq: seq
    }));
    return;
  }

  var existing = await idbGet(db, 'messages', friendId);
  var messages = (existing && existing.messages) ? existing.messages.slice() : [];
  messages.push(msg);
  await idbPut(db, 'messages', { friendId: friendId, messages: messages });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  const targetUrl = new URL(url, self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
