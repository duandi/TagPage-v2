/* ============================================================
   Tag Page v2 — 存储层
   主通道：localStorage（与浏览器刷新行为完全一致，最可靠）
   兜底通道：IndexedDB（仅当 localStorage 超配额时使用，配额更大）
   说明：部分嵌入式环境（预览面板 / webview）里 IndexedDB 会「写入报告成功
        但刷新后读不到」，因此绝不能把它当主通道。
   ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'tagpage';
  var DB_STORE = 'kv';
  var dbPromise = null;

  /* ---------------- localStorage ---------------- */
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  /* localStorage 是否真的可用（有些受限环境直接抛异常） */
  function lsAvailable() {
    try {
      var k = '__tp_probe__';
      localStorage.setItem(k, '1');
      var ok = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- IndexedDB（兜底） ---------------- */
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!global.indexedDB) { resolve(null); return; }
      var req;
      try { req = global.indexedDB.open(DB_NAME, 1); }
      catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore(DB_STORE); } catch (e) { /* ignore */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function idbGet(db, key) {
    return new Promise(function (resolve) {
      try {
        var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        r.onsuccess = function () { resolve(typeof r.value === 'string' ? r.value : null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function idbSet(db, key, value) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    }).then(function (ok) {
      if (!ok) return false;
      // 回读校验：防止个别环境「报告成功但未落盘」的假写入
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
          r.onsuccess = function () { resolve(r.value === value); };
          r.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }

  global.Store = {
    lsAvailable: lsAvailable,

    /* 读取：返回 { value, where }，where ∈ 'localStorage' | 'IndexedDB' | null */
    load: function (key) {
      var ls = lsGet(key);
      if (ls != null) return Promise.resolve({ value: ls, where: 'localStorage' });

      return openDb().then(function (db) {
        if (!db) return { value: null, where: null };
        return idbGet(db, key).then(function (v) {
          return { value: v, where: v != null ? 'IndexedDB' : null };
        });
      });
    },

    /* 写入 localStorage：写入后立即回读校验，返回 { ok, where } */
    set: function (key, value) {
      if (!lsSet(key, value)) return Promise.resolve({ ok: false, where: null, reason: 'quota' });
      if (lsGet(key) !== value) return Promise.resolve({ ok: false, where: null, reason: 'verify' });
      return Promise.resolve({ ok: true, where: 'localStorage' });
    },

    /* 仅在 localStorage 容量不足时使用：IndexedDB 配额更大，
       但个别环境刷新后读不到，所以它只作为最后一道兜底 */
    setIDB: function (key, value) {
      return openDb().then(function (db) {
        if (!db) return { ok: false, where: null };
        return idbSet(db, key, value).then(function (ok) {
          return ok ? { ok: true, where: 'IndexedDB' } : { ok: false, where: null };
        });
      });
    },

    /* 当前数据保存通道的可读描述，用于提示 */
    describe: function (where) {
      if (where === 'localStorage') return '浏览器本地存储';
      if (where === 'IndexedDB') return 'IndexedDB（配额更大）';
      return '未知';
    }
  };
})(window);
