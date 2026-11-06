/* ============================================================
   Tag Page v2 — 零依赖书签导航
   数据格式与原项目 list.json 兼容
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'tagpage:list:v2';
  var META_KEY = 'tagpage:meta:v2';
  var THEME_KEY = 'tagpage:theme';
  var APP_VERSION = '2.4.0';
  var TAG_LABELS = { '1': 'Default', '2': 'Tools', '3': 'Material', '4': 'Google', '5': 'Steam' };
  var UNTAGGED = 'uncategorized';

  var $ = function (id) { return document.getElementById(id); };

  var grid, emptyBox, tagbar, searchInput, searchClear, fileInput;
  var modal, form, modalTitle, modalSubmit;
  var confirmMask, confirmMsg, confirmSub;
  var toasts, body, ctxMenu;

  var list = [];
  var filterTag = 'all';
  var query = '';
  var editingId = null;
  var confirmResolve = null;

  /* ---------------- 工具 ---------------- */
  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast-' + type : '');
    t.textContent = msg;
    toasts.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 2400);
  }

  /* 存储受限（预览面板 / 内嵌 webview 禁止本地存储）时的常驻提示 */
  function showStorageWarning(msg) {
    var box = $('storage-warn');
    if (!box) return;
    var text = $('storage-warn-text');
    if (text && msg) text.textContent = msg;
    box.hidden = false;
  }

  /* ---------------- 存储状态 ---------------- */
  function storageLabel(where) {
    if (where === 'localStorage') return '本地存储';
    if (where === 'IndexedDB') return 'IndexedDB';
    return '未保存';
  }

  function updateStatusChip() {
    var chip = $('status-chip');
    if (!chip) return;
    var where = lastSave ? lastSave.where : null;
    var lean = !!(lastSave && lastSave.lean);
    chip.textContent = list.length + ' 条 · ' + storageLabel(where) + (lean ? '·精简' : '');
    chip.dataset.state = where || 'none';
    chip.title = lean
      ? '存储空间有限，内嵌图标未保存（书签完整）'
      : '存储状态，点击查看诊断信息';
  }

  function openDiag() {
    var lsLen = -1;
    try { lsLen = (localStorage.getItem(STORAGE_KEY) || '').length; } catch (e) { lsLen = -1; }
    var lines = [
      '版本：v' + APP_VERSION,
      '书签数量：' + list.length,
      '本次读取到数据：' + (loadFound ? '是' : '否'),
      '当前保存通道：' + storageLabel(lastSave ? lastSave.where : null),
      'localStorage 可用：' + (Store.lsAvailable() ? '是' : '否'),
      'localStorage 数据字符数：' + (lsLen < 0 ? '读取失败' : String(lsLen)),
      '上次保存时间：' + (lastSave ? new Date(lastSave.at).toLocaleString() : '无'),
      '上次保存是否精简：' + (lastSave && lastSave.lean ? '是（内嵌图标未存）' : '否'),
      '启动时的保存记录：' + (loadMeta && loadMeta.count != null ? loadMeta.count + ' 条' : '无'),
      '页面地址：' + location.href,
      '浏览器：' + navigator.userAgent
    ];
    var body = $('diag-body');
    if (body) body.textContent = lines.join('\n');
    var dlg = $('diag');
    if (dlg) dlg.hidden = false;
  }

  /* ---------------- 右键 / 长按菜单 ---------------- */
  function byId(id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('网址已复制'); },
        function () { toast('复制失败，请手动复制', 'error'); });
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('网址已复制'); }
    catch (e) { toast('复制失败，请手动复制', 'error'); }
    document.body.removeChild(ta);
  }

  function closeCtxMenu() {
    if (!ctxMenu) return;
    ctxMenu.hidden = true;
    ctxMenu.innerHTML = '';
  }

  function openCtxMenu(x, y, item) {
    if (!ctxMenu || !item) return;

    var mk = function (label, danger, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-item' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        closeCtxMenu();
        fn();
      });
      return b;
    };

    ctxMenu.innerHTML = '';
    ctxMenu.appendChild(mk('编辑书签', false, function () { openModal('edit', item); }));
    ctxMenu.appendChild(mk('复制网址', false, function () { copyText(item.url); }));
    ctxMenu.appendChild(mk('在新标签页打开', false, function () {
      window.open(item.url, '_blank', 'noopener');
    }));
    var sep = document.createElement('div');
    sep.className = 'ctx-sep';
    ctxMenu.appendChild(sep);
    ctxMenu.appendChild(mk('删除书签', true, function () { removeItem(item.id); }));

    ctxMenu.hidden = false;
    ctxMenu.style.left = '0px';
    ctxMenu.style.top = '0px';
    var r = ctxMenu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - r.width - 8);
    var top = Math.min(y, window.innerHeight - r.height - 8);
    ctxMenu.style.left = Math.max(8, left) + 'px';
    ctxMenu.style.top = Math.max(8, top) + 'px';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 规范化：补 id、裁剪字段；dedupe=true 时按 url 去重（仅用于导入） */
  function normalize(items, dedupe) {
    var seen = Object.create(null);
    var out = [];
    (items || []).forEach(function (it) {
      if (!it || !it.url) return;
      var url = String(it.url).trim();
      if (!url) return;
      var key = url.toLowerCase();
      if (dedupe) {
        if (seen[key]) return;
        seen[key] = true;
      }

      var type = it.type;
      if (['url', 'svg', 'text'].indexOf(type) === -1) {
        type = it.svg ? 'svg' : (it.logo ? 'url' : 'text');
      }

      out.push({
        id: it.id || uid(),
        title: String(it.title || '').trim() || url,
        url: url,
        type: type,
        logo: it.logo || '',
        svg: it.svg || '',
        svgColor: it.svgColor || '',
        logoText: it.logoText || '',
        logoTextColor: it.logoTextColor || '',
        bgColor: it.bgColor || '',
        tag: it.tag == null ? '' : String(it.tag)
      });
    });
    return out;
  }

  /* ---------------- 持久化 ---------------- */
  var storageWarned = false;
  var lastSave = null;      // { where, chars, lean, at, failed }
  var loadMeta = null;      // 上次保存的元信息 { lean, count, at, where }
  var loadFound = false;    // 本次启动是否成功读到数据

  /* 精简副本：去掉内嵌 base64 图标（保留网址、标题、标签、外链图标）
     目的是在存储空间不足时，至少把书签本体保住 */
  function slimItems(items) {
    return items.map(function (it) {
      var c = {};
      Object.keys(it).forEach(function (k) { c[k] = it[k]; });
      if (typeof c.logo === 'string' && c.logo.indexOf('data:') === 0) c.logo = '';
      return c;
    });
  }

  function writeMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
  }

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; }
  }

  /* 三级写入：localStorage 完整 → localStorage 精简 → IndexedDB
     原则：宁可降级图标，也绝不让书签丢失 */
  function save() {
    var full;
    try {
      full = JSON.stringify(list);
    } catch (e) {
      toast('数据序列化失败', 'error');
      return Promise.resolve();
    }

    return Store.set(STORAGE_KEY, full).then(function (r) {
      if (r.ok) {
        lastSave = { where: r.where, chars: full.length, lean: false, at: Date.now() };
        writeMeta({ lean: false, count: list.length, at: lastSave.at, where: r.where });
        updateStatusChip();
        return r;
      }

      // ① 空间不足：去掉内嵌图标再试
      var lean = JSON.stringify(slimItems(list));
      return Store.set(STORAGE_KEY, lean).then(function (r2) {
        if (r2.ok) {
          lastSave = { where: r2.where, chars: lean.length, lean: true, at: Date.now() };
          writeMeta({ lean: true, count: list.length, at: lastSave.at, where: r2.where });
          updateStatusChip();
          if (!storageWarned) {
            storageWarned = true;
            toast('存储空间有限，书签已保存（内嵌图标未保存）', 'error');
          }
          return r2;
        }

        // ② 兜底：IndexedDB（配额更大，但个别环境刷新后读不到）
        return Store.setIDB(STORAGE_KEY, full).then(function (r3) {
          if (r3.ok) {
            lastSave = { where: r3.where, chars: full.length, lean: false, at: Date.now() };
            writeMeta({ lean: false, count: list.length, at: lastSave.at, where: r3.where });
            updateStatusChip();
            return r3;
          }
          lastSave = { where: null, chars: full.length, lean: false, at: Date.now(), failed: true };
          writeMeta({ lean: false, count: list.length, at: lastSave.at, where: null, failed: true });
          updateStatusChip();
          if (!storageWarned) {
            storageWarned = true;
            toast('浏览器存储不可用，本次修改不会被保存', 'error');
          }
          return r3;
        });
      });
    });
  }

  function load() {
    // 只从本地存储读取；没有数据就保持空白，由用户手动添加或导入
    loadMeta = readMeta();
    return Store.load(STORAGE_KEY).then(function (res) {
      if (res.value) {
        try {
          var parsed = JSON.parse(res.value);
          if (Array.isArray(parsed)) {
            list = normalize(parsed, false);
            loadFound = true;
            lastSave = {
              where: res.where,
              chars: res.value.length,
              lean: !!(loadMeta && loadMeta.lean),
              at: Date.now()
            };
            if (lastSave.lean) {
              setTimeout(function () {
                toast('上次因存储空间限制，内嵌图标未保存（书签完整）', 'error');
              }, 600);
            }
            /* 若数据只存在于 IndexedDB（旧版本写入的），立即回迁到 localStorage */
            if (res.where === 'IndexedDB') save();
            return;
          }
        } catch (e) {
          toast('本地数据已损坏，已按空数据启动', 'error');
        }
      }
      list = [];
      /* 上次确实保存过数据、这次却读不到 → 明确告知，而不是静默变空白 */
      if (loadMeta && loadMeta.count > 0) {
        showStorageWarning('上次保存了 ' + loadMeta.count + ' 条数据，但本次启动没能读到。' +
          '当前浏览器可能禁止了本地存储（隐私模式 / 清理策略 / 内嵌预览）。请用浏览器直接打开 index.html，并在设置中允许该站点保存数据。');
      }
    });
  }

  /* ---------------- 数据视图 ---------------- */
  function tagCounts() {
    var c = { all: list.length };
    list.forEach(function (it) {
      var k = it.tag || UNTAGGED;
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }

  function tagLabel(t) {
    if (t === 'all') return '全部';
    if (t === UNTAGGED) return '未分类';
    return TAG_LABELS[t] || ('标签 ' + t);
  }

  function currentView() {
    var arr = list;
    if (filterTag !== 'all') {
      arr = arr.filter(function (it) {
        return filterTag === UNTAGGED ? !it.tag : it.tag === filterTag;
      });
    }
    if (query) {
      var q = query.toLowerCase();
      arr = arr.filter(function (it) {
        return (it.title || '').toLowerCase().indexOf(q) > -1 ||
          (it.url || '').toLowerCase().indexOf(q) > -1;
      });
    }
    return arr;
  }

  /* ---------------- 渲染 ---------------- */
  function textLogo(it) {
    var b = document.createElement('b');
    b.className = 'logo-text';
    var text = it.logoText || (it.title || '?').trim().slice(0, 2) || '?';
    b.textContent = text;
    /* 按字数缩放：字越多字号越小，保证不超出卡片（CJK 字宽按 1em、拉丁按 0.55em 估） */
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += text.charCodeAt(i) > 0x2e80 ? 1 : 0.55;
    }
    var factor = Math.min(0.3, 0.82 / Math.max(w, 0.75));
    b.style.fontSize = 'calc(var(--tile, 120px) * ' + factor.toFixed(3) + ')';
    if (it.logoTextColor) b.style.color = it.logoTextColor;
    return b;
  }

  function buildCard(it, draggable) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = it.id;
    card.draggable = !!draggable;
    card.title = it.title + '\n' + it.url + '\n（右键或点右上角 ⋯ 可编辑 / 删除）';

    // 悬浮操作
    var tools = document.createElement('div');
    tools.className = 'card-tools';

    var editBtn = document.createElement('button');
    editBtn.className = 'tool-btn';
    editBtn.type = 'button';
    editBtn.title = '编辑';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openModal('edit', it);
    });

    var delBtn = document.createElement('button');
    delBtn.className = 'tool-btn del';
    delBtn.type = 'button';
    delBtn.title = '删除';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      removeItem(it.id);
    });

    tools.appendChild(editBtn);
    tools.appendChild(delBtn);

    /* 小磁贴的入口：右上角 ⋯ （与右键菜单同一份功能） */
    var moreBtn = document.createElement('button');
    moreBtn.className = 'card-more';
    moreBtn.type = 'button';
    moreBtn.title = '更多操作';
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var r = moreBtn.getBoundingClientRect();
      openCtxMenu(r.right, r.bottom + 4, it);
    });

    // 链接主体
    var a = document.createElement('a');
    a.className = 'card-link';
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.draggable = false;
    if (it.bgColor) a.style.background = it.bgColor;

    if (it.type === 'url' && it.logo) {
      var img = document.createElement('img');
      img.src = it.logo;
      img.alt = it.title;
      img.loading = 'lazy';
      img.draggable = false;
      // 图标加载失败时回退为文字图标，避免破图
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        a.appendChild(textLogo(it));
      });
      a.appendChild(img);
    } else if (it.type === 'svg' && it.svg) {
      var box = document.createElement('div');
      box.className = 'logo-svg';
      // SVG 为本地数据，直接注入
      box.innerHTML = it.svg;
      if (it.svgColor) box.style.fill = it.svgColor;
      a.appendChild(box);
    } else {
      a.appendChild(textLogo(it));
    }

    card.appendChild(tools);
    card.appendChild(a);
    card.appendChild(moreBtn);
    return card;
  }

  function renderTags() {
    var c = tagCounts();
    var order = ['all', '1', '2', '3', '4', '5', UNTAGGED];
    var keys = [];
    order.forEach(function (k) {
      if (k === 'all' || c[k]) keys.push(k);
    });
    Object.keys(c).forEach(function (k) {
      if (order.indexOf(k) === -1) keys.push(k);
    });

    var html = keys.map(function (k) {
      var active = filterTag === k ? ' active' : '';
      return '<button class="chip' + active + '" data-tag="' + escapeHtml(k) + '">' +
        escapeHtml(tagLabel(k)) +
        '<span class="chip-count">' + (c[k] || 0) + '</span>' +
        '</button>';
    }).join('');
    tagbar.innerHTML = html;
  }

  function render() {
    var arr = currentView();
    var dragEnabled = filterTag === 'all' && !query;

    var frag = document.createDocumentFragment();
    arr.forEach(function (it) { frag.appendChild(buildCard(it, dragEnabled)); });
    grid.innerHTML = '';
    grid.appendChild(frag);
    grid.classList.toggle('no-drag', !dragEnabled);

    renderTags();
    searchClear.hidden = !query;

    if (!arr.length) {
      emptyBox.hidden = false;
      emptyBox.innerHTML = list.length
        ? '<div class="empty-icon">🔍</div><h3>没有匹配的书签</h3><p>换个关键词或标签试试</p>'
        : '<div class="empty-icon">📚</div><h3>还没有书签</h3><p>点击右下角 + 添加，或用工具栏的导入按钮载入 JSON 备份</p>';
    } else {
      emptyBox.hidden = true;
    }

    layoutGrid();
    updateStatusChip();
  }

  /* ---------------- 磁贴布局（同原项目算法） ----------------
     枚举列数 → 计算该列数下磁贴的可用尺寸 → 取「磁贴最大」的方案。
     由于 tile = min(可用宽, 可用高)，算出的网格必定完整落在舞台内，
     因此页面任何情况下都不会出现横向/纵向滚动条。 */
  var layingOut = false;

  function layoutGrid() {
    if (layingOut || !grid) return;
    var n = grid.children.length;
    var W = grid.clientWidth;
    var H = grid.clientHeight;
    if (!W || !H) return;

    if (!n) {
      grid.style.gridTemplateColumns = 'none';
      grid.style.setProperty('--tile', '120px');
      return;
    }

    layingOut = true;
    /* 间距也参与寻优：磁贴很小的时候用更小的间距，可以换到更大的磁贴。
       网格四周的内边距 = 磁贴间距，因此边缘到浏览器边缘的留白与磁贴间隔一致。
       磁贴按宽/高分别精确计算（允许极轻微长方形），保证两个方向都严格铺满、
       留白处处等于间距。 */
    var gapCandidates = W < 760 ? [5, 8] : [8, 10, 12];
    var maxCols = Math.min(n, Math.max(1, Math.floor(W / 32)));
    var bestTile = 0;
    var bestCols = 1;
    var bestGap = gapCandidates[0];

    gapCandidates.forEach(function (gap) {
      /* 扣除四周内边距（左右/上下各一个 gap） */
      var availW = W - gap * 2;
      var availH = H - gap * 2;
      if (availW <= 0 || availH <= 0) return;
      for (var cols = 1; cols <= maxCols; cols++) {
        var rows = Math.ceil(n / cols);
        var tileW = (availW - (cols - 1) * gap) / cols;
        var tileH = (availH - (rows - 1) * gap) / rows;
        var tile = Math.min(tileW, tileH);
        if (tile > bestTile) {
          bestTile = tile;
          bestCols = cols;
          bestGap = gap;
        }
      }
    });

    var availW = W - bestGap * 2;
    var availH = H - bestGap * 2;
    var rows = Math.ceil(n / bestCols);
    /* 用最终选中的列数按宽/高精确求解，网格两个方向都严丝合缝 */
    var tileW = (availW - (bestCols - 1) * bestGap) / bestCols;
    var tileH = (availH - (rows - 1) * bestGap) / rows;
    var tilePx = Math.max(16, Math.min(tileW, tileH));

    grid.style.gridTemplateColumns = 'repeat(' + bestCols + ', ' + tileW + 'px)';
    grid.style.gridAutoRows = tileH + 'px';
    grid.style.gap = bestGap + 'px';
    grid.style.padding = bestGap + 'px';
    grid.style.setProperty('--tile', tilePx + 'px');
    grid.classList.toggle('compact', tilePx < 76);
    grid.classList.toggle('nano', tilePx < 30);
    layingOut = false;
  }

  /* ---------------- 弹窗表单 ---------------- */
  function setType(type) {
    var radios = form.querySelectorAll('input[name="type"]');
    Array.prototype.forEach.call(radios, function (r) {
      r.checked = r.value === type;
    });
    var groups = form.querySelectorAll('[data-group]');
    Array.prototype.forEach.call(groups, function (g) {
      g.hidden = g.getAttribute('data-group') !== type;
    });
  }

  function fillForm(o) {
    o = o || {};
    $('f-title').value = o.title || '';
    $('f-url').value = o.url || '';
    setType(o.type || 'url');
    $('f-logo').value = o.logo || '';
    $('f-svg').value = o.svg || '';
    $('f-svgcolor').value = o.svgColor || '';
    $('f-logotext').value = o.logoText || '';
    $('f-logotextcolor').value = o.logoTextColor || '';
    $('f-bgcolor').value = o.bgColor || '';
    $('f-tag').value = o.tag == null ? '' : String(o.tag);
    clearInvalid();
  }

  function readForm() {
    var checked = form.querySelector('input[name="type"]:checked');
    return {
      title: $('f-title').value.trim(),
      url: $('f-url').value.trim(),
      type: checked ? checked.value : 'text',
      logo: $('f-logo').value.trim(),
      svg: $('f-svg').value.trim(),
      svgColor: $('f-svgcolor').value.trim(),
      logoText: $('f-logotext').value.trim(),
      logoTextColor: $('f-logotextcolor').value.trim(),
      bgColor: $('f-bgcolor').value.trim(),
      tag: $('f-tag').value
    };
  }

  function clearInvalid() {
    var els = form.querySelectorAll('.invalid');
    Array.prototype.forEach.call(els, function (x) { x.classList.remove('invalid'); });
  }

  function markInvalid(id, msg) {
    var f = $(id);
    if (f) { f.classList.add('invalid'); f.focus(); }
    toast(msg, 'error');
  }

  function openModal(mode, item) {
    editingId = mode === 'edit' && item ? item.id : null;
    modalTitle.textContent = editingId ? '编辑书签' : '添加网址';
    modalSubmit.textContent = editingId ? '保存' : '添加';
    fillForm(item || {});
    modal.hidden = false;
    body.classList.add('lock');
    setTimeout(function () { $('f-title').focus(); }, 60);
  }

  function closeModal() {
    modal.hidden = true;
    body.classList.remove('lock');
    editingId = null;
  }

  /* ---------------- 增删改 ---------------- */
  function submitForm(e) {
    e.preventDefault();
    clearInvalid();

    var d = readForm();
    if (!d.title) return markInvalid('f-title', '请填写标题');
    if (!d.url) return markInvalid('f-url', '请填写网址');
    if (d.type === 'url' && !d.logo) return markInvalid('f-logo', '请填写图标地址，或切换图标类型');
    if (d.type === 'svg' && !d.svg) return markInvalid('f-svg', '请粘贴 SVG 代码，或切换图标类型');
    if (d.type === 'text' && !d.logoText) return markInvalid('f-logotext', '请填写图标文字，或切换图标类型');

    if (!/^(https?:\/\/|mailto:|tel:)/i.test(d.url)) {
      d.url = 'https://' + d.url.replace(/^\/+/, '');
    }

    if (editingId) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === editingId) { idx = i; break; }
      }
      if (idx > -1) {
        var merged = Object.assign({}, list[idx], d, { id: editingId });
        list[idx] = merged;
      }
      toast('已保存');
    } else {
      list.push(Object.assign({ id: uid() }, d));
      toast('已添加');
    }

    save();
    render();
    closeModal();
  }

  function removeItem(id) {
    var it = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { it = list[i]; break; }
    }
    if (!it) return;

    uiConfirm('删除这个书签？', it.title || it.url, '删除').then(function (ok) {
      if (!ok) return;
      list = list.filter(function (x) { return x.id !== id; });
      save();
      render();
      toast('已删除');
    });
  }

  /* ---------------- 确认框 ---------------- */
  function uiConfirm(title, sub, okText) {
    confirmMsg.textContent = title;
    confirmSub.textContent = sub || '';
    confirmSub.hidden = !sub;
    $('confirm-ok').textContent = okText || '确定';
    confirmMask.hidden = false;
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }

  function resolveConfirm(v) {
    confirmMask.hidden = true;
    if (confirmResolve) {
      var fn = confirmResolve;
      confirmResolve = null;
      fn(v);
    }
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      var parsed;
      try {
        parsed = JSON.parse(evt.target.result);
      } catch (err) {
        toast('导入失败：不是合法的 JSON 文件', 'error');
        return;
      }
      if (!Array.isArray(parsed)) {
        toast('导入失败：内容需为数组', 'error');
        return;
      }

      var incoming = normalize(parsed, true);

      // 合并策略：以导入文件为准（备份恢复语义）
      // 已存在的 URL 用导入版本覆盖，新 URL 追加到末尾，保持原有顺序
      var map = Object.create(null);
      list.forEach(function (it) { map[it.url.toLowerCase()] = it; });

      var added = 0;
      var updated = 0;
      incoming.forEach(function (it) {
        if (map[it.url.toLowerCase()]) updated++;
        else added++;
        map[it.url.toLowerCase()] = it;
      });

      var seen = Object.create(null);
      var next = [];
      list.forEach(function (it) {
        var k = it.url.toLowerCase();
        seen[k] = true;
        next.push(map[k]);
      });
      incoming.forEach(function (it) {
        var k = it.url.toLowerCase();
        if (!seen[k]) {
          seen[k] = true;
          next.push(it);
        }
      });
      list = next;

      render();
      // 等待真正落盘后再提示，避免「提示成功但刷新即丢」的假成功
      save().then(function (r) {
        if (r.ok) {
          toast('导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条');
        }
      });
    };
    reader.onerror = function () { toast('读取文件失败', 'error'); };
    reader.readAsText(file);
  }

  function exportFile() {
    if (!list.length) { toast('没有可导出的数据', 'error'); return; }
    var data = JSON.stringify(list, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'tagpage_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 ' + list.length + ' 条书签');
  }

  /* ---------------- 主题 ---------------- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------------- 拖拽排序 ---------------- */
  function initDrag() {
    /* 右键菜单：任意尺寸下都能编辑 / 删除 */
    grid.addEventListener('contextmenu', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (!card) return;
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, byId(card.dataset.id));
    });

    /* 触屏长按 0.5s 打开同一菜单 */
    var pressTimer = null, pressX = 0, pressY = 0, longPressed = false;
    grid.addEventListener('touchstart', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (!card || e.touches.length !== 1) return;
      longPressed = false;
      pressX = e.touches[0].clientX;
      pressY = e.touches[0].clientY;
      var id = card.dataset.id;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        longPressed = true;
        openCtxMenu(pressX, pressY, byId(id));
      }, 520);
    }, { passive: true });
    grid.addEventListener('touchmove', function () { clearTimeout(pressTimer); }, { passive: true });
    grid.addEventListener('touchend', function () { clearTimeout(pressTimer); }, { passive: true });

    /* 点击别处 / 滚动 / 缩放时关闭菜单 */
    document.addEventListener('click', function (e) {
      if (!ctxMenu || ctxMenu.hidden) return;
      if (e.target.closest && e.target.closest('#ctx-menu')) return;
      closeCtxMenu();
    });
    window.addEventListener('resize', closeCtxMenu);
    document.addEventListener('scroll', closeCtxMenu, true);

    grid.addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (!card || !card.draggable) return;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (err) { /* ignore */ }
    });

    grid.addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (card) card.classList.remove('dragging');
      commitOrder();
    });

    grid.addEventListener('dragover', function (e) {
      e.preventDefault();
      var dragging = grid.querySelector('.card.dragging');
      if (!dragging) return;
      var target = e.target.closest ? e.target.closest('.card') : null;
      if (!target || target === dragging) return;
      var rect = target.getBoundingClientRect();
      var before = e.clientX < rect.left + rect.width / 2;
      grid.insertBefore(dragging, before ? target : target.nextSibling);
    });

    grid.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  function commitOrder() {
    // 仅在「全部 + 无搜索」时可拖拽，此时 DOM 顺序即完整数据顺序
    if (filterTag !== 'all' || query) return;
    var ids = Array.prototype.map.call(
      grid.querySelectorAll('.card'),
      function (c) { return c.dataset.id; }
    );
    if (ids.length !== list.length) return;

    var map = Object.create(null);
    list.forEach(function (it) { map[it.id] = it; });
    var next = ids.map(function (id) { return map[id]; }).filter(Boolean);
    if (next.length === list.length) {
      list = next;
      save();
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 标签筛选
    tagbar.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip') : null;
      if (!btn) return;
      var t = btn.getAttribute('data-tag');
      filterTag = (t === 'all') ? 'all' : t;
      render();
    });

    // 搜索
    searchInput.addEventListener('input', function () {
      query = searchInput.value.trim();
      render();
    });
    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      query = '';
      searchInput.focus();
      render();
    });

    // 顶栏按钮
    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-export').addEventListener('click', exportFile);
    $('btn-import').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      importFile(f);
    });
    $('btn-add').addEventListener('click', function () { openModal('add'); });

    // 弹窗
    $('modal-close').addEventListener('click', closeModal);
    $('modal-cancel').addEventListener('click', closeModal);
    $('modal-reset').addEventListener('click', function () { fillForm({}); });
    form.addEventListener('submit', submitForm);
    form.addEventListener('change', function (e) {
      if (e.target.name === 'type') setType(e.target.value);
    });
    form.addEventListener('input', function (e) {
      if (e.target.classList) e.target.classList.remove('invalid');
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // 确认框
    $('confirm-ok').addEventListener('click', function () { resolveConfirm(true); });
    $('confirm-cancel').addEventListener('click', function () { resolveConfirm(false); });
    confirmMask.addEventListener('click', function (e) {
      if (e.target === confirmMask) resolveConfirm(false);
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      var isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
      if (e.key === 'Escape') {
        if (ctxMenu && !ctxMenu.hidden) { closeCtxMenu(); return; }
        if (!confirmMask.hidden) { resolveConfirm(false); return; }
        if (!modal.hidden) { closeModal(); return; }
        if (query) { searchInput.value = ''; query = ''; render(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      if (!isTyping && (e.key === 'n' || e.key === 'N')
        && modal.hidden && confirmMask.hidden) {
        e.preventDefault();
        openModal('add');
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    grid = $('grid');
    emptyBox = $('empty');
    tagbar = $('tagbar');
    searchInput = $('search');
    searchClear = $('search-clear');
    fileInput = $('file-input');
    modal = $('modal');
    form = $('form');
    modalTitle = $('modal-title');
    modalSubmit = $('modal-submit');
    confirmMask = $('confirm');
    confirmMsg = $('confirm-msg');
    confirmSub = $('confirm-sub');
    toasts = $('toasts');
    ctxMenu = $('ctx-menu');
    body = document.body;

    var savedTheme = null;
    try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { savedTheme = null; }
    setTheme(savedTheme === 'light' ? 'light' : 'dark');

    if (!Store.lsAvailable()) {
      showStorageWarning('当前浏览器禁止网页写入本地存储，导入的数据刷新后会丢失。请换成普通窗口并允许站点保存数据。');
    }

    var warnClose = $('storage-warn-close');
    if (warnClose) warnClose.addEventListener('click', function () { $('storage-warn').hidden = true; });

    var chip = $('status-chip');
    if (chip) chip.addEventListener('click', openDiag);

    var diagClose = $('diag-close');
    if (diagClose) diagClose.addEventListener('click', function () { $('diag').hidden = true; });

    var diagCopy = $('diag-copy');
    if (diagCopy) diagCopy.addEventListener('click', function () {
      var text = $('diag-body').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('诊断信息已复制'); },
          function () { toast('复制失败，请手动选中上面文字', 'error'); });
      } else {
        toast('请手动选中上面文字复制');
      }
    });

    load().then(function () {
      bind();
      initDrag();
      render();
      updateStatusChip();

      /* 视口变化（缩放窗口 / 旋转屏幕 / 提示条出现）时重新计算磁贴 */
      if (window.ResizeObserver) {
        new ResizeObserver(function () { layoutGrid(); }).observe(grid);
      } else {
        window.addEventListener('resize', layoutGrid);
      }
      window.addEventListener('orientationchange', function () {
        setTimeout(layoutGrid, 120);
      });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(layoutGrid);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
