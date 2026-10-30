/* 波轮盘展示架 - 前端交互逻辑 */

let state = { shelves: [] };
let editingDisc = null;      // 当前编辑的波轮盘引用 {shelfId, layerId, discId} 或 null(新建)
let editingContext = null;   // 新建时的位置 {shelfId, layerId}
let tempImageUrl = "";
let layerPages = {};         // 每层当前页码 {layerId: pageIndex}，UI 状态不持久化
let swapMode = false;        // 排序模式：点两张卡片互换位置
let swapPick = null;         // 已选中的第一张 {shelfId, layerId, discId}

const DISCS_PER_PAGE = 6;    // 每页显示的波轮盘数量
const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;  // 触摸设备禁用原生拖拽
const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

function getPage(layerId) {
  return layerPages[layerId] || 0;
}
function setPage(layerId, page) {
  layerPages[layerId] = page;
}
function clampPage(layer) {
  const total = Math.max(1, Math.ceil(layer.discs.length / DISCS_PER_PAGE));
  const cur = getPage(layer.id);
  if (cur >= total) setPage(layer.id, total - 1);
}

// ---------- 初始化 ----------
async function init() {
  await loadState();
  if (!state.shelves || state.shelves.length === 0) addShelf(true);
  render();
  bindEvents();
  startSync();
}

// ---------- 货架操作 ----------
function newLayer() {
  return { id: uid(), diameter: "", capacity: 8, discs: [] };
}

function addShelf(layerCount = 6, silent = false) {
  const shelf = {
    id: uid(),
    name: `货架 ${state.shelves.length + 1}`,
    layers: Array.from({ length: layerCount }, newLayer),
  };
  state.shelves.push(shelf);
  if (!silent) {
    render();
    autoSave();
  }
}

function removeShelf(shelfId) {
  if (!confirm("确定删除该货架及其所有波轮盘吗？")) return;
  state.shelves = state.shelves.filter((s) => s.id !== shelfId);
  render();
  autoSave();
}

function updateShelfName(shelfId, name) {
  const s = state.shelves.find((x) => x.id === shelfId);
  if (s) s.name = name;
  autoSave();
}

function updateLayer(shelfId, layerId, field, value) {
  const s = state.shelves.find((x) => x.id === shelfId);
  if (!s) return;
  const l = s.layers.find((x) => x.id === layerId);
  if (!l) return;
  if (field === "capacity") value = Math.max(1, parseInt(value) || 1);
  l[field] = value;
  autoSave();
}

// ---------- 波轮盘操作 ----------
function openDiscModal(shelfId, layerId, discId = null) {
  editingContext = { shelfId, layerId };
  if (discId) {
    const s = state.shelves.find((x) => x.id === shelfId);
    const l = s.layers.find((x) => x.id === layerId);
    const d = l.discs.find((x) => x.id === discId);
    editingDisc = { shelfId, layerId, discId };
    $("#modal-title").textContent = "编辑波轮盘";
    $("#in-name").value = d.name || "";
    $("#in-diameter").value = d.diameter || "";
    $("#in-stock").value = d.stock || 0;
    $("#in-price").value = d.price || "";
    tempImageUrl = d.image || "";
    $("#btn-modal-delete").classList.remove("hidden");
  } else {
    editingDisc = null;
    $("#modal-title").textContent = "新增波轮盘";
    $("#in-name").value = "";
    $("#in-diameter").value = "";
    $("#in-stock").value = 0;
    $("#in-price").value = "";
    tempImageUrl = "";
    $("#btn-modal-delete").classList.add("hidden");
  }
  $("#in-image").value = "";
  renderImagePreview();
  $("#modal").classList.remove("hidden");
  $("#in-name").focus();
}

function closeModal() {
  $("#modal").classList.add("hidden");
  editingDisc = null;
  editingContext = null;
  tempImageUrl = "";
}

function renderImagePreview() {
  const box = $("#image-preview");
  box.innerHTML = "";
  if (tempImageUrl) {
    const img = document.createElement("img");
    img.src = tempImageUrl;
    box.appendChild(img);
  }
}

function saveDisc() {
  const name = $("#in-name").value.trim();
  const diameter = $("#in-diameter").value;
  const stock = parseInt($("#in-stock").value) || 0;
  const price = $("#in-price").value.trim();
  if (!name) { alert("请填写名称"); return; }

  const { shelfId, layerId } = editingContext;
  const s = state.shelves.find((x) => x.id === shelfId);
  const l = s.layers.find((x) => x.id === layerId);

  if (editingDisc) {
    const d = l.discs.find((x) => x.id === editingDisc.discId);
    d.name = name;
    d.diameter = diameter;
    d.stock = stock;
    d.price = price;
    d.image = tempImageUrl;
  } else {
    if (l.discs.length >= l.capacity) {
      alert(`该层已满（容量 ${l.capacity}），请先调整容量或删除其他波轮盘`);
      return;
    }
    l.discs.push({
      id: uid(),
      name,
      diameter,
      stock,
      price,
      image: tempImageUrl,
    });
  }
  closeModal();
  render();
  autoSave();
}

function deleteDisc() {
  if (!editingDisc) return;
  if (!confirm("确定删除该波轮盘吗？")) return;
  const { shelfId, layerId, discId } = editingDisc;
  const s = state.shelves.find((x) => x.id === shelfId);
  const l = s.layers.find((x) => x.id === layerId);
  l.discs = l.discs.filter((d) => d.id !== discId);
  closeModal();
  render();
  autoSave();
}

// ---------- 拖拽 ----------
let dragData = null; // {shelfId, layerId, discId}

function onDragStart(e, shelfId, layerId, discId) {
  dragData = { shelfId, layerId, discId };
  e.target.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", discId);
}

function onDragEnd(e) {
  e.target.classList.remove("dragging");
  document.querySelectorAll(".layer-items").forEach((el) => el.classList.remove("drag-over"));
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDrop(e, targetShelfId, targetLayerId) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  if (!dragData) return;
  const src = dragData;
  dragData = null;
  const targetDiscEl = e.target.closest(".disc");
  moveDisc(src, targetShelfId, targetLayerId, targetDiscEl ? targetDiscEl.dataset.disc : null);
}

// 移动/重排波轮盘（鼠标拖拽与手机长按拖动共用）
function moveDisc(src, targetShelfId, targetLayerId, targetDiscId) {
  const { shelfId, layerId, discId } = src;
  const sSrc = state.shelves.find((x) => x.id === shelfId);
  if (!sSrc) return;
  const lSrc = sSrc.layers.find((x) => x.id === layerId);
  if (!lSrc) return;
  const disc = lSrc.discs.find((x) => x.id === discId);
  if (!disc) return;

  const sDst = state.shelves.find((x) => x.id === targetShelfId);
  if (!sDst) return;
  const lDst = sDst.layers.find((x) => x.id === targetLayerId);
  if (!lDst) return;

  const srcIdx = lSrc.discs.findIndex((d) => d.id === discId);
  lSrc.discs.splice(srcIdx, 1);

  if (lDst.id === lSrc.id) {
    // 同层：重排
    if (targetDiscId && targetDiscId !== discId) {
      const dstIdx = lDst.discs.findIndex((d) => d.id === targetDiscId);
      lDst.discs.splice(dstIdx, 0, disc);
    } else {
      // 拖到空白处，放回原位
      lSrc.discs.splice(srcIdx, 0, disc);
    }
  } else {
    // 跨层
    if (lDst.discs.length >= lDst.capacity) {
      lSrc.discs.splice(srcIdx, 0, disc); // 还原
      alert(`目标层已满（容量 ${lDst.capacity}）`);
      return;
    }
    if (targetDiscId) {
      const dstIdx = lDst.discs.findIndex((d) => d.id === targetDiscId);
      lDst.discs.splice(dstIdx, 0, disc);
    } else {
      lDst.discs.push(disc);
    }
  }
  render();
  autoSave();
}

// ---------- 手机端：长按拖动 ----------
let touchDrag = null;
let suppressClick = false;

function onTouchStart(e, el, shelfId, layerId, discId) {
  if (swapMode) return;
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const drag = {
    shelfId, layerId, discId, el,
    startX: t.clientX, startY: t.clientY,
    active: false, timer: null, ghost: null,
  };
  drag.timer = setTimeout(() => {
    if (touchDrag !== drag) return;
    drag.active = true;
    el.classList.add("dragging");
    // 跟手的半透明浮层，避免手指遮挡且能看出正在拖哪张
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.left = t.clientX + "px";
    ghost.style.top = t.clientY + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    if (navigator.vibrate) navigator.vibrate(25);
  }, 350);
  touchDrag = drag;
}

function onTouchMove(e) {
  if (!touchDrag) return;
  const t = e.touches[0];
  if (!t) return;
  if (!touchDrag.active) {
    // 长按未完成就滑动 => 认为是滚动页面，取消拖动
    if (Math.abs(t.clientX - touchDrag.startX) > 10 || Math.abs(t.clientY - touchDrag.startY) > 10) {
      clearTimeout(touchDrag.timer);
      touchDrag = null;
    }
    return;
  }
  e.preventDefault();
  if (touchDrag.ghost) {
    touchDrag.ghost.style.left = t.clientX + "px";
    touchDrag.ghost.style.top = t.clientY + "px";
  }
  document.querySelectorAll(".layer-items").forEach((el) => el.classList.remove("drag-over"));
  const under = document.elementFromPoint(t.clientX, t.clientY);
  const box = under && under.closest(".layer-items");
  if (box) box.classList.add("drag-over");
}

function onTouchEnd(e) {
  if (!touchDrag) return;
  const drag = touchDrag;
  clearTimeout(drag.timer);
  touchDrag = null;
  drag.el.classList.remove("dragging");
  if (drag.ghost) { drag.ghost.remove(); drag.ghost = null; }
  document.querySelectorAll(".layer-items").forEach((el) => el.classList.remove("drag-over"));
  if (!drag.active) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 600);

  const last = e.changedTouches && e.changedTouches[0];
  if (!last) return;
  const under = document.elementFromPoint(last.clientX, last.clientY);
  const box = under && under.closest(".layer-items");
  if (!box) return;
  const targetDiscEl = under.closest(".disc");
  moveDisc(
    { shelfId: drag.shelfId, layerId: drag.layerId, discId: drag.discId },
    box.dataset.shelf,
    box.dataset.layer,
    targetDiscEl ? targetDiscEl.dataset.disc : null
  );
}

// ---------- 渲染 ----------
function render() {
  const container = $("#shelf-container");
  container.innerHTML = "";
  if (state.shelves.length === 0) {
    container.innerHTML = '<div class="empty-hint" style="color:#888;">暂无货架，点击右上角"添加货架"开始</div>';
    return;
  }
  state.shelves.forEach((shelf) => {
    container.appendChild(renderShelf(shelf));
  });
}

function renderShelf(shelf) {
  const el = document.createElement("div");
  el.className = "shelf";
  el.innerHTML = `
    <div class="shelf-header">
      <input class="shelf-name" value="${escapeHtml(shelf.name)}" placeholder="货架名称" />
      <div>
        <button class="btn btn-sm btn-danger" data-act="del-shelf" data-id="${shelf.id}">删除货架</button>
      </div>
    </div>
  `;
  shelf.layers.forEach((layer, idx) => {
    el.appendChild(renderLayer(shelf.id, layer, idx));
  });
  return el;
}

function renderLayer(shelfId, layer, idx) {
  clampPage(layer);
  const page = getPage(layer.id);
  const totalPages = Math.max(1, Math.ceil(layer.discs.length / DISCS_PER_PAGE));
  const start = page * DISCS_PER_PAGE;
  const pageDiscs = layer.discs.slice(start, start + DISCS_PER_PAGE);

  const el = document.createElement("div");
  el.className = "layer";
  el.innerHTML = `
    <div class="layer-header">
      <span class="layer-label">第${idx + 1}层</span>
      <input class="layer-diameter" type="text" placeholder="直径 mm (如 340)"
        value="${escapeHtml(layer.diameter || "")}" data-shelf="${shelfId}" data-layer="${layer.id}" data-field="diameter" />
      <input class="layer-capacity" type="number" min="1" title="该层容量"
        value="${layer.capacity}" data-shelf="${shelfId}" data-layer="${layer.id}" data-field="capacity" />
      <button class="btn btn-sm btn-primary layer-add" data-shelf="${shelfId}" data-layer="${layer.id}">+</button>
    </div>
    <div class="layer-items" data-shelf="${shelfId}" data-layer="${layer.id}"></div>
    <div class="layer-pager" data-layer="${layer.id}">
      <button class="btn btn-sm page-prev" data-layer="${layer.id}" ${page <= 0 ? "disabled" : ""}>◀ 上一页</button>
      <span class="page-info">第 ${page + 1} / ${totalPages} 页（共 ${layer.discs.length} 个）</span>
      <button class="btn btn-sm page-next" data-layer="${layer.id}" ${page >= totalPages - 1 ? "disabled" : ""}>下一页 ▶</button>
    </div>
  `;
  const itemsBox = el.querySelector(".layer-items");
  if (pageDiscs.length === 0) {
    itemsBox.innerHTML = '<div class="empty-hint">空</div>';
  } else {
    pageDiscs.forEach((d) => itemsBox.appendChild(renderDisc(shelfId, layer.id, d)));
  }
  // 绑定拖拽
  itemsBox.addEventListener("dragover", onDragOver);
  itemsBox.addEventListener("dragleave", onDragLeave);
  itemsBox.addEventListener("drop", (e) => onDrop(e, shelfId, layer.id));
  return el;
}

function changePage(layerId, delta) {
  const s = state.shelves.find((x) => x.layers.some((l) => l.id === layerId));
  if (!s) return;
  const l = s.layers.find((x) => x.id === layerId);
  const totalPages = Math.max(1, Math.ceil(l.discs.length / DISCS_PER_PAGE));
  let page = getPage(layerId) + delta;
  if (page < 0) page = 0;
  if (page > totalPages - 1) page = totalPages - 1;
  setPage(layerId, page);
  render();
}

function renderDisc(shelfId, layerId, disc) {
  const el = document.createElement("div");
  el.className = "disc";
  el.draggable = !isTouchDevice;
  el.dataset.shelf = shelfId;
  el.dataset.layer = layerId;
  el.dataset.disc = disc.id;
  if (swapMode) {
    el.classList.add("swap-selectable");
    if (swapPick && swapPick.discId === disc.id) el.classList.add("swap-picked");
  }
  const imgHtml = disc.image
    ? `<img class="disc-img" draggable="false" src="${disc.image}" alt="" />`
    : `<div class="disc-img" style="display:flex;align-items:center;justify-content:center;font-size:40px;color:#bbb;">◯</div>`;
  const priceHtml = disc.price
    ? `<div class="disc-price">¥${escapeHtml(disc.price)}</div>`
    : "";
  el.innerHTML = `
    ${imgHtml}
    ${priceHtml}
    <div class="disc-name" title="${escapeHtml(disc.name)}">${escapeHtml(disc.name)}</div>
    <div class="disc-stock">${disc.stock || 0}</div>
  `;
  el.addEventListener("dragstart", (e) => onDragStart(e, shelfId, layerId, disc.id));
  el.addEventListener("dragend", onDragEnd);
  el.addEventListener("click", () => {
    if (swapMode) { handleSwapClick(shelfId, layerId, disc.id); return; }
    if (suppressClick) return;
    openDiscModal(shelfId, layerId, disc.id);
  });
  el.addEventListener("touchstart", (e) => onTouchStart(e, el, shelfId, layerId, disc.id), { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  el.addEventListener("touchcancel", onTouchEnd);
  const imgEl = el.querySelector("img.disc-img");
  if (imgEl) {
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (swapMode) { handleSwapClick(shelfId, layerId, disc.id); return; }
      if (suppressClick) return;
      openLightbox(
        disc.image,
        disc.name,
        disc.diameter,
        shelfId,
        layerId,
        disc.id,
        disc.price
      );
    });
  }
  return el;
}

// ---------- 图片放大 ----------
let lightboxDisc = null;

function openLightbox(src, name, diameter, shelfId, layerId, discId, price) {
  lightboxDisc = { shelfId, layerId, discId };
  const box = $("#lightbox");
  $("#lightbox-img").src = src;
  $("#lightbox-caption").textContent = diameter
    ? `${name || ""}  直径 ${diameter} mm`
    : (name || "");
  $("#lightbox-price").value = price || "";
  box.classList.remove("hidden");
}

// 在放大视图里直接填写/修改价格
function saveLightboxPrice() {
  if (!lightboxDisc) return;
  const { shelfId, layerId, discId } = lightboxDisc;
  const s = state.shelves.find((x) => x.id === shelfId);
  const l = s && s.layers.find((x) => x.id === layerId);
  const d = l && l.discs.find((x) => x.id === discId);
  if (!d) return;
  const val = $("#lightbox-price").value.trim();
  if ((d.price || "") === val) return;
  d.price = val;
  autoSave();
  render();
}

function closeLightbox() {
  saveLightboxPrice();
  lightboxDisc = null;
  $("#lightbox").classList.add("hidden");
  $("#lightbox-img").src = "";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

// ---------- 排序模式（点两张卡片互换位置） ----------
function toggleSwapMode() {
  swapMode = !swapMode;
  swapPick = null;
  const btn = $("#btn-swap");
  if (btn) btn.classList.toggle("btn-active", swapMode);
  document.body.classList.toggle("swap-mode", swapMode);
  $("#save-status").textContent = swapMode ? "排序模式：点第一张，再点第二张即互换" : "";
  render();
}

function findDiscPos(shelfId, layerId, discId) {
  const shelf = state.shelves.find((s) => s.id === shelfId);
  if (!shelf) return null;
  const layer = shelf.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const idx = layer.discs.findIndex((d) => d.id === discId);
  if (idx === -1) return null;
  return { layer, idx };
}

function handleSwapClick(shelfId, layerId, discId) {
  if (!swapPick) {
    swapPick = { shelfId, layerId, discId };
    render();
    return;
  }
  if (swapPick.discId === discId) {
    swapPick = null;
    render();
    return;
  }
  const a = findDiscPos(swapPick.shelfId, swapPick.layerId, swapPick.discId);
  const b = findDiscPos(shelfId, layerId, discId);
  swapPick = null;
  if (!a || !b) { render(); return; }
  const tmp = a.layer.discs[a.idx];
  a.layer.discs[a.idx] = b.layer.discs[b.idx];
  b.layer.discs[b.idx] = tmp;
  render();
  autoSave();
  $("#save-status").textContent = "排序模式：已互换，可继续点选";
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $("#btn-add-shelf").addEventListener("click", () => {
  const input = prompt("请输入货架层数（1-20）：", "6");
  if (input === null) return;
  const n = parseInt(input);
  if (isNaN(n) || n < 1 || n > 20) {
    alert("请输入 1-20 之间的整数");
    return;
  }
  addShelf(n);
});
  $("#btn-save").addEventListener("click", () => saveToServer(true));
  $("#btn-swap").addEventListener("click", toggleSwapMode);

  $("#lightbox").addEventListener("click", closeLightbox);
  $("#lightbox-price-row").addEventListener("click", (e) => e.stopPropagation());
  $("#lightbox-price").addEventListener("change", saveLightboxPrice);
  $("#lightbox-price").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveLightboxPrice();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  $("#shelf-container").addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && t.dataset.act === "del-shelf") {
      removeShelf(t.dataset.id);
      return;
    }
    const addBtn = e.target.closest(".layer-add");
    if (addBtn) {
      openDiscModal(addBtn.dataset.shelf, addBtn.dataset.layer);
      return;
    }
    const prevBtn = e.target.closest(".page-prev");
    if (prevBtn && !prevBtn.disabled) {
      changePage(prevBtn.dataset.layer, -1);
      return;
    }
    const nextBtn = e.target.closest(".page-next");
    if (nextBtn && !nextBtn.disabled) {
      changePage(nextBtn.dataset.layer, 1);
      return;
    }
  });

  $("#shelf-container").addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("shelf-name")) {
      // 找到所属货架
      const shelfEl = t.closest(".shelf");
      const shelfId = shelfEl.querySelector(".shelf-name") && shelfEl.querySelector("[data-act='del-shelf']").dataset.id;
      updateShelfName(shelfId, t.value);
    }
    if (t.classList.contains("layer-diameter") || t.classList.contains("layer-capacity")) {
      updateLayer(t.dataset.shelf, t.dataset.layer, t.dataset.field, t.value);
    }
  });

  // 模态框
  $("#btn-modal-cancel").addEventListener("click", closeModal);
  $("#btn-modal-save").addEventListener("click", saveDisc);
  $("#btn-modal-delete").addEventListener("click", deleteDisc);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

  $("#in-image").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      tempImageUrl = await handleImageFile(file);
      renderImagePreview();
    } catch (err) {
      alert("上传出错：" + err.message);
    }
  });
}

// 客户端压缩图片：maxSize 为最长边上限，quality 为 JPEG 质量 0-1
function compressImage(file, maxSize = 400, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("压缩失败"));
            const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            resolve(new File([blob], name, { type: "image/jpeg" }));
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

// ---------- 存储层：Supabase 云端 + 本地缓存 ----------
const CFG = window.APP_CONFIG || {};
const CACHE_KEY = "wlp_state_v1";
const SYNC_TS_KEY = "wlp_sync_ts_v1";

const hasCloud = () => !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);

const authHeaders = () => ({
  apikey: CFG.SUPABASE_KEY,
  Authorization: "Bearer " + CFG.SUPABASE_KEY,
});

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

function cloudUrl() {
  return `${CFG.SUPABASE_URL}/rest/v1/${CFG.TABLE}?id=eq.${CFG.ROW_ID}&select=data,updated_at`;
}

// 本地 Flask 环境的一次性迁移：读取旧的 data.json
async function tryLegacyImport() {
  try {
    const res = await fetch("/api/data");
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.shelves && json.shelves.length) return json;
  } catch (e) {
    /* 静态环境下没有该接口，忽略 */
  }
  return null;
}

async function loadState() {
  const cached = readCache();
  state = cached && cached.shelves ? cached : { shelves: [] };

  if (state.shelves.length === 0) {
    const legacy = await tryLegacyImport();
    if (legacy) {
      state = legacy;
      writeCache(state);
    }
  }

  if (!hasCloud()) return state;

  let cloudEmpty = false;
  try {
    const res = await fetch(cloudUrl(), { headers: authHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    if (rows.length && rows[0].data && rows[0].data.shelves && rows[0].data.shelves.length) {
      state = rows[0].data;
      writeCache(state);
      localStorage.setItem(SYNC_TS_KEY, rows[0].updated_at || "");
    } else {
      cloudEmpty = true;
    }
  } catch (e) {
    console.warn("云端读取失败，改用本地缓存", e);
  }

  // 云端还没有数据时，把本机数据推上去
  if (cloudEmpty && state.shelves.length) {
    pushCloud().catch((e) => console.warn("初始同步失败", e));
  }
  return state;
}

async function pushCloud() {
  const ts = new Date().toISOString();
  const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${CFG.TABLE}?on_conflict=id`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{ id: CFG.ROW_ID, data: state, updated_at: ts }]),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  localStorage.setItem(SYNC_TS_KEY, ts);
}

// 每隔一段时间拉取云端最新数据，实现手机/电脑同步
function startSync() {
  if (!hasCloud()) return;
  setInterval(async () => {
    if (saveTimer) return;
    try {
      const res = await fetch(cloudUrl(), { headers: authHeaders() });
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) return;
      const ts = rows[0].updated_at || "";
      const last = localStorage.getItem(SYNC_TS_KEY) || "";
      if (ts && ts > last && rows[0].data && rows[0].data.shelves) {
        state = rows[0].data;
        writeCache(state);
        localStorage.setItem(SYNC_TS_KEY, ts);
        render();
        $("#save-status").textContent = "已同步最新数据";
      }
    } catch (e) {
      /* 忽略网络错误 */
    }
  }, 15000);
}

// 图片：已压缩的图片上传到 Supabase 存储桶；未配置则转 base64 存本地
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("读取失败"));
    r.readAsDataURL(blob);
  });
}

async function handleImageFile(file) {
  const compressed = await compressImage(file, 400, 0.7);
  if (!hasCloud()) return blobToDataUrl(compressed);

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const res = await fetch(`${CFG.SUPABASE_URL}/storage/v1/object/${CFG.BUCKET}/${name}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: compressed,
  });
  if (!res.ok) throw new Error("图片上传失败，请检查存储桶权限 (" + res.status + ")");
  return `${CFG.SUPABASE_URL}/storage/v1/object/public/${CFG.BUCKET}/${name}`;
}

// ---------- 自动保存 ----------
let saveTimer = null;
function autoSave() {
  $("#save-status").textContent = "保存中...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveToServer(false), 400);
}

async function saveToServer(showMsg) {
  saveTimer = null;
  const cached = writeCache(state);
  if (!cached) $("#save-status").textContent = "本机空间不足";

  if (!hasCloud()) {
    $("#save-status").textContent = cached ? "已保存到本机（未配置云同步）" : "保存失败";
    if (showMsg) alert("已保存到本机（尚未配置云端同步）");
    return;
  }
  try {
    await pushCloud();
    $("#save-status").textContent = "已同步 ✓";
    if (showMsg) alert("已同步到云端");
  } catch (err) {
    $("#save-status").textContent = "同步失败（已存本机）";
    if (showMsg) alert("云端同步失败：" + err.message);
  }
}

init();
