// ============================================================
// ระบบให้เกรดงานเย็บ — app.js
// ============================================================

// ---------- CONFIG: ใส่ค่า Supabase ของคุณตรงนี้ ----------
const SUPABASE_URL = "https://rslsjllwrbgjdqavhmbk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbHNqbGx3cmJnamRxYXZobWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MDgwMzIsImV4cCI6MjA5ODI4NDAzMn0.pvqr3fkLTZH76cvYYo-7gteJKKORtnlnZwSWA7UkEqM";
const STORAGE_BUCKET = "sewing-photos";

const TAILOR_PIN = "1125";
const ADMIN_PIN = "1168";

const GRADE_LABELS = {
  A: "เกรด A — ไม่พบข้อบกพร่อง",
  B: "เกรด B — ไม่เก็บเศษด้าย",
  C: "เกรด C — ไม่ผ่านมาตรฐาน",
  BB: "เกรด BB — แก้กลับมาแล้ว",
};
const GRADE_SHORT = { A: "A", B: "B", C: "C", BB: "BB" };

// ---------- Supabase client ----------
let sb = null;
function initSupabase() {
  if (!SUPABASE_URL.startsWith("http")) return false;
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return true;
}

// ---------- Global state ----------
const state = {
  role: null, // 'tailor' | 'admin'
  pinBuffer: "",
  tailors: [],      // [{id,name}]
  styles: [],       // [{id,name}]
  submissions: [],  // full nested tree, newest first
  draft: null,      // current in-progress submission draft (tailor view)
  uploadingCount: 0,
  adminTab: "tailor", // 'tailor' | 'week'
  adminFilterTailor: null,
};

// ---------- Utility ----------
function uid() {
  return "tmp-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fmtDateThai(iso) {
  const d = new Date(iso + "T00:00:00");
  const months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function fmtDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  const months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show" + (type ? " " + type : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ""; }, 2600);
}
function setSyncDot(status) {
  // status: 'live' | 'busy' | 'off'
  ["sync-dot-tailor", "sync-dot-admin"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "sync-dot" + (status === "live" ? " live" : status === "busy" ? " busy" : "");
  });
}

// ---------- Week helpers ----------
// วีค 1: วันสุดท้ายของเดือนก่อน - วันที่ 14 ของเดือนนี้
// วีค 2: วันที่ 15 - ก่อนวันสุดท้ายของเดือน (วันสุดท้ายของเดือนเข้าวีค1 ของเดือนถัดไป)
function lastDayOfMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}
function getWeekInfo(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDate();
  const y = d.getFullYear();
  const m = d.getMonth();
  const lastDay = lastDayOfMonth(y, m);
  if (day === lastDay) {
    const next = new Date(y, m + 1, 1);
    return { weekNum: 1, year: next.getFullYear(), month: next.getMonth() };
  } else if (day <= 14) {
    return { weekNum: 1, year: y, month: m };
  } else {
    return { weekNum: 2, year: y, month: m };
  }
}
function weekKey(iso) {
  const w = getWeekInfo(iso);
  return `${w.year}-${String(w.month + 1).padStart(2, "0")}-W${w.weekNum}`;
}
function weekLabel(key) {
  const [y, m, w] = key.split("-");
  const months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  const monthName = months[parseInt(m, 10) - 1];
  const weekNum = w.replace("W", "");
  const range = weekNum === "1" ? "ปลายเดือนก่อน–14" : "15–ก่อนสิ้นเดือน";
  return `วีค ${weekNum} · ${monthName} ${y} (${range})`;
}

// ============================================================
// AUTH / LOGIN (PIN cached per-device via localStorage)
// ============================================================
const LS_ROLE_KEY = "sewinggrade_role";

function checkSavedLogin() {
  const saved = localStorage.getItem(LS_ROLE_KEY);
  if (saved === "tailor" || saved === "admin") {
    enterApp(saved);
    return true;
  }
  return false;
}

function renderLoginScreen() {
  const dotsEl = document.getElementById("pin-dots");
  const padEl = document.getElementById("pin-pad");
  dotsEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement("div");
    dot.className = "pin-dot" + (i < state.pinBuffer.length ? " filled" : "");
    dotsEl.appendChild(dot);
  }
  if (padEl.childElementCount === 0) {
    const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];
    keys.forEach((k) => {
      const btn = document.createElement("button");
      if (k === "") {
        btn.className = "pin-key ghost";
        btn.disabled = true;
      } else if (k === "del") {
        btn.className = "pin-key";
        btn.innerHTML = "⌫";
        btn.onclick = () => onPinKey("del");
      } else {
        btn.className = "pin-key";
        btn.textContent = k;
        btn.onclick = () => onPinKey(k);
      }
      padEl.appendChild(btn);
    });
  }
}

function onPinKey(k) {
  const errEl = document.getElementById("login-err");
  if (k === "del") {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    errEl.textContent = "";
    renderLoginScreen();
    return;
  }
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += k;
  renderLoginScreen();
  if (state.pinBuffer.length === 4) {
    setTimeout(() => verifyPin(), 120);
  }
}

function verifyPin() {
  const errEl = document.getElementById("login-err");
  const pin = state.pinBuffer;
  if (pin === TAILOR_PIN) {
    localStorage.setItem(LS_ROLE_KEY, "tailor");
    enterApp("tailor");
  } else if (pin === ADMIN_PIN) {
    localStorage.setItem(LS_ROLE_KEY, "admin");
    enterApp("admin");
  } else {
    errEl.textContent = "รหัสไม่ถูกต้อง ลองอีกครั้ง";
    state.pinBuffer = "";
    renderLoginScreen();
    const box = document.querySelector(".login-box");
    box.style.animation = "none";
    requestAnimationFrame(() => { box.style.animation = "shake .35s"; });
  }
}

function enterApp(role) {
  state.role = role;
  state.pinBuffer = "";
  showScreen(role === "tailor" ? "tailor-screen" : "admin-screen");
  if (role === "tailor") {
    initTailorDraft();
    renderTailorScreen();
  } else {
    renderAdminScreen();
  }
}

function logout() {
  localStorage.removeItem(LS_ROLE_KEY);
  state.role = null;
  state.draft = null;
  showScreen("login-screen");
  renderLoginScreen();
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// shake keyframe injected
const styleTag = document.createElement("style");
styleTag.textContent = `@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}`;
document.head.appendChild(styleTag);

// ============================================================
// DATA LAYER — load + realtime subscribe
// ============================================================

async function loadAllData() {
  setSyncDot("busy");
  try {
    const [tailorsRes, stylesRes, subsRes] = await Promise.all([
      sb.from("tailors").select("*").order("name"),
      sb.from("styles").select("*").order("name"),
      sb.from("submissions").select(`
        *,
        submission_items (
          *,
          item_colors (
            *,
            item_color_images ( * )
          )
        )
      `).order("submitted_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (tailorsRes.error) throw tailorsRes.error;
    if (stylesRes.error) throw stylesRes.error;
    if (subsRes.error) throw subsRes.error;

    state.tailors = tailorsRes.data || [];
    state.styles = stylesRes.data || [];
    state.submissions = (subsRes.data || []).map(normalizeSubmission);

    setSyncDot("live");
  } catch (e) {
    console.error(e);
    setSyncDot("off");
    toast("โหลดข้อมูลไม่สำเร็จ: " + (e.message || e), "err");
  }
}

function normalizeSubmission(sub) {
  sub.submission_items = (sub.submission_items || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  sub.submission_items.forEach((item) => {
    item.item_colors = (item.item_colors || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    item.item_colors.forEach((c) => {
      c.item_color_images = (c.item_color_images || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      if (!Array.isArray(c.grade_history)) c.grade_history = [];
    });
  });
  return sub;
}

let realtimeChannel = null;
function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = sb.channel("sewing-grade-changes");
  ["submissions", "submission_items", "item_colors", "item_color_images", "tailors", "styles"].forEach((table) => {
    realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      debounceReload();
    });
  });
  realtimeChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") setSyncDot("live");
  });
}

let reloadTimer = null;
function debounceReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadAllData();
    if (state.role === "admin") renderAdminScreen();
    if (state.role === "tailor") renderTailorScreen(true);
  }, 450);
}


// ============================================================
// TAILOR VIEW — draft submission, items, colors, images
// ============================================================

function initTailorDraft() {
  if (state.draft) return;
  state.draft = {
    id: null, // null until saved as a real submission row first time
    tailor_name: "",
    submitted_date: todayISO(),
    note: "",
    items: [], // [{id, style_name, colors:[{id,color_name,current_grade,bb_round,grade_history,images:[{id,public_url,storage_path,uploading}]}]}]
  };
}

function newColorRow() {
  return {
    id: uid(),
    color_name: "",
    current_grade: "",
    bb_round: null,
    grade_history: [],
    images: [],
    _isNew: true,
  };
}
function newItemBlock(styleName) {
  return {
    id: uid(),
    style_name: styleName || "",
    colors: [newColorRow()],
    _isNew: true,
  };
}

function renderTailorScreen(preserveScroll) {
  const root = document.getElementById("tailor-content");
  const scrollY = window.scrollY;
  const d = state.draft;

  root.innerHTML = `
    <div class="card">
      <div class="section-label">ใบงานวันนี้</div>
      <div class="field">
        <label>ชื่อช่างผู้ส่งงาน</label>
        <div class="ac-wrap">
          <input class="input" id="f-tailor-name" placeholder="พิมพ์ชื่อช่าง..." value="${escapeHtml(d.tailor_name)}" autocomplete="off">
          <div class="ac-list" id="ac-tailor"></div>
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>วันที่ส่งงาน</label>
        <input class="input" type="date" id="f-date" value="${d.submitted_date}">
      </div>
    </div>

    <div id="items-container"></div>

    <div class="card" style="background:transparent;border:1.5px dashed var(--line-soft);">
      <div class="section-label">เพิ่มรุ่นเสื้อ</div>
      <div class="add-item-bar">
        <div class="ac-wrap">
          <input class="input" id="f-new-style" placeholder="พิมพ์ชื่อรุ่น..." autocomplete="off">
          <div class="ac-list" id="ac-style"></div>
        </div>
        <button class="btn btn-primary" id="btn-add-item">+ เพิ่ม</button>
      </div>
    </div>

    <div class="card">
      <div class="section-label">หมายเหตุ (ถ้ามี)</div>
      <textarea class="textarea" id="f-note" placeholder="บันทึกเพิ่มเติม...">${escapeHtml(d.note)}</textarea>
    </div>
  `;

  renderItemsContainer();

  document.getElementById("f-tailor-name").addEventListener("input", (e) => {
    d.tailor_name = e.target.value;
    showAutocomplete("ac-tailor", e.target.value, state.tailors.map((t) => t.name), (val) => {
      d.tailor_name = val;
      document.getElementById("f-tailor-name").value = val;
      hideAutocomplete("ac-tailor");
    });
  });
  document.getElementById("f-tailor-name").addEventListener("focus", (e) => {
    showAutocomplete("ac-tailor", e.target.value, state.tailors.map((t) => t.name), (val) => {
      d.tailor_name = val;
      document.getElementById("f-tailor-name").value = val;
      hideAutocomplete("ac-tailor");
    });
  });
  document.getElementById("f-date").addEventListener("change", (e) => {
    d.submitted_date = e.target.value;
  });
  document.getElementById("f-note").addEventListener("input", (e) => {
    d.note = e.target.value;
  });

  const newStyleInput = document.getElementById("f-new-style");
  newStyleInput.addEventListener("input", (e) => {
    showAutocomplete("ac-style", e.target.value, state.styles.map((s) => s.name), (val) => {
      newStyleInput.value = val;
      hideAutocomplete("ac-style");
    });
  });
  newStyleInput.addEventListener("focus", (e) => {
    showAutocomplete("ac-style", e.target.value, state.styles.map((s) => s.name), (val) => {
      newStyleInput.value = val;
      hideAutocomplete("ac-style");
    });
  });
  newStyleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addItemFromInput(); }
  });
  document.getElementById("btn-add-item").addEventListener("click", addItemFromInput);

  document.addEventListener("click", globalAcDismiss, { once: true });

  // floating submit bar
  let fab = document.getElementById("tailor-fab");
  if (!fab) {
    fab = document.createElement("button");
    fab.id = "tailor-fab";
    fab.className = "btn btn-primary fab";
    document.getElementById("tailor-screen").appendChild(fab);
    fab.addEventListener("click", submitDraft);
  }
  const itemCount = d.items.length;
  fab.textContent = itemCount > 0 ? `ส่งงาน (${itemCount} รุ่น)` : "ส่งงาน";
  fab.style.display = itemCount > 0 && d.tailor_name.trim() ? "block" : "none";

  if (preserveScroll) window.scrollTo(0, scrollY);
}

function globalAcDismiss(e) {
  document.querySelectorAll(".ac-list.show").forEach((el) => {
    if (!el.previousElementSibling.contains(e.target) && el !== e.target) {
      el.classList.remove("show");
    }
  });
}

function showAutocomplete(listId, query, options, onPick) {
  const list = document.getElementById(listId);
  if (!list) return;
  const q = query.trim().toLowerCase();
  let filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options.slice(0, 8);
  filtered = filtered.slice(0, 8);
  let html = "";
  filtered.forEach((opt) => {
    html += `<div class="ac-item" data-val="${escapeHtml(opt)}">${escapeHtml(opt)}</div>`;
  });
  if (q && !options.some((o) => o.toLowerCase() === q)) {
    html += `<div class="ac-item" data-val="${escapeHtml(query)}"><span class="ac-new">+ ใหม่</span> ${escapeHtml(query)}</div>`;
  }
  list.innerHTML = html;
  list.classList.toggle("show", html.length > 0);
  list.querySelectorAll(".ac-item").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onPick(el.dataset.val);
    });
  });
}
function hideAutocomplete(listId) {
  const list = document.getElementById(listId);
  if (list) list.classList.remove("show");
}

function addItemFromInput() {
  const input = document.getElementById("f-new-style");
  const val = input.value.trim();
  if (!val) { toast("กรอกชื่อรุ่นก่อน"); return; }
  state.draft.items.push(newItemBlock(val));
  input.value = "";
  hideAutocomplete("ac-style");
  renderItemsContainer();
  updateFab();
}

function updateFab() {
  const fab = document.getElementById("tailor-fab");
  if (!fab) return;
  const d = state.draft;
  const itemCount = d.items.length;
  fab.textContent = itemCount > 0 ? `ส่งงาน (${itemCount} รุ่น)` : "ส่งงาน";
  fab.style.display = itemCount > 0 && d.tailor_name.trim() ? "block" : "none";
}


function renderItemsContainer() {
  const root = document.getElementById("items-container");
  const d = state.draft;
  if (d.items.length === 0) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = d.items.map((item, itemIdx) => renderItemBlockHtml(item, itemIdx)).join("");

  d.items.forEach((item, itemIdx) => {
    // remove item
    root.querySelector(`[data-remove-item="${item.id}"]`).addEventListener("click", () => {
      if (item.colors.some(c => c.images.length > 0 || c.current_grade)) {
        if (!confirm(`ลบรุ่น "${item.style_name}" ทั้งหมด?`)) return;
      }
      d.items.splice(itemIdx, 1);
      renderItemsContainer();
      updateFab();
    });

    item.colors.forEach((color, colorIdx) => {
      wireColorRow(item, color, itemIdx, colorIdx);
    });

    root.querySelector(`[data-add-color="${item.id}"]`).addEventListener("click", () => {
      item.colors.push(newColorRow());
      renderItemsContainer();
    });
  });
}

function renderItemBlockHtml(item, itemIdx) {
  return `
    <div class="item-block" data-item-id="${item.id}">
      <div class="item-block-head">
        <div class="item-style-name">${escapeHtml(item.style_name)}</div>
        <button class="remove-x" data-remove-item="${item.id}">✕</button>
      </div>
      <div id="colors-${item.id}">
        ${item.colors.map((c, ci) => renderColorRowHtml(item, c, ci)).join("")}
      </div>
      <button class="add-color-btn" data-add-color="${item.id}">+ เพิ่มสี</button>
    </div>
  `;
}

function renderColorRowHtml(item, color, colorIdx) {
  const grades = ["A", "B", "C", "BB"];
  const gradeBtns = grades.map((g) => `<div class="grade-opt ${color.current_grade === g ? "active" : ""}" data-g="${g}" data-color-id="${color.id}">${g}</div>`).join("");

  let bbRow = "";
  if (color.current_grade === "BB") {
    bbRow = `
      <div class="bb-round-row" data-bb-row="${color.id}">
        <label>แก้ครั้งที่</label>
        <div class="bb-round-stepper">
          <button class="bb-step-btn" data-bb-dec="${color.id}">−</button>
          <span class="bb-round-val" id="bb-val-${color.id}">${color.bb_round || 1}</span>
          <button class="bb-step-btn" data-bb-inc="${color.id}">+</button>
        </div>
      </div>`;
  }

  let histHtml = "";
  if (color.grade_history.length > 0) {
    const chips = color.grade_history.map((h) => {
      const label = h.grade === "BB" ? `BB${h.bb_round || ""}` : h.grade;
      return `<span class="hist-chip">${label}</span>`;
    }).join("→");
    histHtml = `<div class="grade-history-tag">ประวัติ: ${chips}</div>`;
  }

  const imgGrid = color.images.map((img) => `
    <div class="img-thumb ${img.uploading ? "uploading" : ""}" data-img-id="${img.id}">
      ${img.uploading ? '<div class="spinner"></div>' : `<img src="${img.public_url}" data-lightbox="${img.public_url}">`}
      ${!img.uploading ? `<div class="img-del" data-del-img="${color.id}|${img.id}">✕</div>` : ""}
    </div>
  `).join("");

  return `
    <div class="color-row" data-color-id="${color.id}">
      <div class="color-row-top">
        <input class="input" placeholder="ระบุสี (เช่น ดำ, ขาว, กรม)" value="${escapeHtml(color.color_name)}" data-color-name="${color.id}">
      </div>
      <div class="grade-picker" data-grade-picker="${color.id}">${gradeBtns}</div>
      ${bbRow}
      ${histHtml}
      <div class="img-grid" data-img-grid="${color.id}">
        ${imgGrid}
        <div class="img-add" data-add-img="${color.id}">
          <span style="font-size:18px;">+</span><span>เพิ่มรูป</span>
        </div>
      </div>
      <div class="color-remove-row">
        <button data-remove-color="${color.id}">✕ ลบสีนี้</button>
      </div>
    </div>
  `;
}

function wireColorRow(item, color, itemIdx, colorIdx) {
  const root = document.getElementById("items-container");
  const row = root.querySelector(`[data-color-id="${color.id}"]`);
  if (!row) return;

  row.querySelector(`[data-color-name="${color.id}"]`).addEventListener("input", (e) => {
    color.color_name = e.target.value;
  });

  row.querySelectorAll(`[data-grade-picker="${color.id}"] .grade-opt`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.g;
      applyGradeChange(color, g);
      renderItemsContainer();
    });
  });

  const decBtn = row.querySelector(`[data-bb-dec="${color.id}"]`);
  const incBtn = row.querySelector(`[data-bb-inc="${color.id}"]`);
  if (decBtn) decBtn.addEventListener("click", () => {
    color.bb_round = Math.max(1, (color.bb_round || 1) - 1);
    document.getElementById(`bb-val-${color.id}`).textContent = color.bb_round;
  });
  if (incBtn) incBtn.addEventListener("click", () => {
    color.bb_round = (color.bb_round || 1) + 1;
    document.getElementById(`bb-val-${color.id}`).textContent = color.bb_round;
  });

  row.querySelector(`[data-add-img="${color.id}"]`).addEventListener("click", () => {
    openFilePicker(color);
  });

  row.querySelectorAll(`[data-del-img]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const [colorId, imgId] = btn.dataset.delImg.split("|");
      removeDraftImage(color, imgId);
    });
  });

  row.querySelectorAll(`[data-lightbox]`).forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.dataset.lightbox));
  });

  row.querySelector(`[data-remove-color="${color.id}"]`).addEventListener("click", () => {
    if (color.images.length > 0 || color.current_grade) {
      if (!confirm("ลบสีนี้ทั้งหมด?")) return;
    }
    item.colors.splice(colorIdx, 1);
    if (item.colors.length === 0) item.colors.push(newColorRow());
    renderItemsContainer();
  });
}

// เกรดเปลี่ยน -> บันทึกประวัติ (ค้าง C เดิมไว้เป็น history เมื่อแก้กลับมาเป็น BB)
function applyGradeChange(color, newGrade) {
  const prevGrade = color.current_grade;
  if (newGrade === prevGrade) return;

  if (prevGrade === "C" && newGrade === "BB") {
    color.grade_history.push({ grade: "C", at: new Date().toISOString() });
    color.bb_round = 1;
  } else if (prevGrade === "BB" && newGrade === "BB") {
    // ไม่ควรเกิดเพราะ newGrade!==prevGrade guard ไว้แล้ว
  } else if (newGrade === "BB" && prevGrade !== "C") {
    color.bb_round = (color.bb_round || 0) + 1;
    if (prevGrade === "BB") color.grade_history.push({ grade: "BB", bb_round: color.bb_round - 1, at: new Date().toISOString() });
  } else {
    color.bb_round = null;
  }
  color.current_grade = newGrade;
}


// ============================================================
// IMAGE UPLOAD (Supabase Storage)
// ============================================================
let pendingUploadColor = null;

function openFilePicker(color) {
  pendingUploadColor = color;
  const input = document.getElementById("file-input");
  input.value = "";
  input.click();
}

document.getElementById("file-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0 || !pendingUploadColor) return;
  const color = pendingUploadColor;

  for (const file of files) {
    const localId = uid();
    const placeholderUrl = URL.createObjectURL(file);
    color.images.push({ id: localId, public_url: placeholderUrl, storage_path: null, uploading: true });
  }
  renderItemsContainer();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const imgEntry = color.images[color.images.length - files.length + i];
    try {
      const compressed = await compressImage(file, 1600, 0.78);
      const ext = "jpg";
      const path = `${todayISO()}/${uid()}.${ext}`;
      const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, compressed, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      imgEntry.public_url = pub.publicUrl;
      imgEntry.storage_path = path;
      imgEntry.uploading = false;

      // ถ้า color row นี้มีอยู่ในฐานข้อมูลแล้ว (ไม่ใช่ draft ใหม่) ให้บันทึกลง DB ทันที
      if (color._dbId) {
        await sb.from("item_color_images").insert({
          item_color_id: color._dbId,
          storage_path: path,
          public_url: pub.publicUrl,
          sort_order: color.images.length,
        });
      }
    } catch (err) {
      console.error(err);
      toast("อัปโหลดรูปไม่สำเร็จ", "err");
      imgEntry.uploading = false;
      imgEntry._failed = true;
    }
    renderItemsContainer();
  }
});

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function removeDraftImage(color, imgId) {
  const idx = color.images.findIndex((im) => im.id === imgId);
  if (idx === -1) return;
  const img = color.images[idx];
  if (!confirm("ลบรูปนี้?")) return;
  color.images.splice(idx, 1);
  renderItemsContainer();
  if (img.storage_path) {
    try {
      await sb.storage.from(STORAGE_BUCKET).remove([img.storage_path]);
      if (img._dbId) await sb.from("item_color_images").delete().eq("id", img._dbId);
    } catch (e) { console.error(e); }
  }
}

// ============================================================
// LIGHTBOX
// ============================================================
function openLightbox(url) {
  document.getElementById("lightbox-img").src = url;
  document.getElementById("lightbox").classList.add("show");
}
document.getElementById("lightbox-close").addEventListener("click", () => {
  document.getElementById("lightbox").classList.remove("show");
});
document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") document.getElementById("lightbox").classList.remove("show");
});


// ============================================================
// SUBMIT DRAFT -> Supabase (insert submission + items + colors + images)
// ============================================================
async function submitDraft() {
  const d = state.draft;
  if (!d.tailor_name.trim()) { toast("กรอกชื่อช่างก่อน"); return; }
  if (d.items.length === 0) { toast("เพิ่มรุ่นเสื้ออย่างน้อย 1 รายการ"); return; }

  // เช็ครูปที่ยังอัปโหลดไม่เสร็จ
  const stillUploading = d.items.some((it) => it.colors.some((c) => c.images.some((im) => im.uploading)));
  if (stillUploading) { toast("รอรูปอัปโหลดให้เสร็จก่อน"); return; }

  const fab = document.getElementById("tailor-fab");
  fab.disabled = true;
  fab.textContent = "กำลังบันทึก...";
  setSyncDot("busy");

  try {
    // 1. upsert tailor + styles ลง lookup table (เพื่อ autocomplete ครั้งหน้า)
    await sb.from("tailors").upsert({ name: d.tailor_name.trim() }, { onConflict: "name" });
    const uniqueStyles = [...new Set(d.items.map((it) => it.style_name.trim()).filter(Boolean))];
    if (uniqueStyles.length) {
      await sb.from("styles").upsert(uniqueStyles.map((name) => ({ name })), { onConflict: "name" });
    }

    // 2. insert submission
    const { data: subRow, error: subErr } = await sb.from("submissions").insert({
      tailor_name: d.tailor_name.trim(),
      submitted_date: d.submitted_date,
      note: d.note.trim() || null,
    }).select().single();
    if (subErr) throw subErr;

    // 3. insert items + colors + images
    for (let i = 0; i < d.items.length; i++) {
      const item = d.items[i];
      const { data: itemRow, error: itemErr } = await sb.from("submission_items").insert({
        submission_id: subRow.id,
        style_name: item.style_name.trim(),
        sort_order: i,
      }).select().single();
      if (itemErr) throw itemErr;

      for (let j = 0; j < item.colors.length; j++) {
        const color = item.colors[j];
        if (!color.color_name.trim() && !color.current_grade && color.images.length === 0) continue; // skip totally empty row
        const { data: colorRow, error: colorErr } = await sb.from("item_colors").insert({
          item_id: itemRow.id,
          color_name: color.color_name.trim(),
          current_grade: color.current_grade || "",
          bb_round: color.bb_round || null,
          grade_history: color.grade_history,
          sort_order: j,
        }).select().single();
        if (colorErr) throw colorErr;

        const validImages = color.images.filter((im) => im.storage_path && !im._failed);
        if (validImages.length) {
          const rows = validImages.map((im, k) => ({
            item_color_id: colorRow.id,
            storage_path: im.storage_path,
            public_url: im.public_url,
            sort_order: k,
          }));
          await sb.from("item_color_images").insert(rows);
        }
      }
    }

    toast("ส่งงานสำเร็จ", "ok");
    state.draft = null;
    initTailorDraft();
    await loadAllData();
    renderTailorScreen();
  } catch (err) {
    console.error(err);
    toast("บันทึกไม่สำเร็จ: " + (err.message || err), "err");
  } finally {
    setSyncDot("live");
    const fabEl = document.getElementById("tailor-fab");
    if (fabEl) fabEl.disabled = false;
  }
}


// ============================================================
// ADMIN VIEW
// ============================================================
function renderAdminScreen() {
  const root = document.getElementById("admin-content");
  root.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${state.adminTab === "tailor" ? "active" : ""}" data-tab="tailor">ตามช่าง</button>
      <button class="tab-btn ${state.adminTab === "week" ? "active" : ""}" data-tab="week">ตามวีค</button>
      <button class="tab-btn ${state.adminTab === "stats" ? "active" : ""}" data-tab="stats">สถิติ</button>
      <button class="tab-btn ${state.adminTab === "report" ? "active" : ""}" data-tab="report">รายงานวัน</button>
    </div>
    <div id="admin-tab-body"></div>
  `;
  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.adminTab = btn.dataset.tab;
      renderAdminScreen();
    });
  });

  const body = document.getElementById("admin-tab-body");
  if (state.submissions.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="es-title">ยังไม่มีงานส่งเข้ามา</div><div class="es-sub">รอช่างส่งงานครั้งแรก ข้อมูลจะ sync มาที่นี่ทันที</div></div>`;
    return;
  }

  if (state.adminTab === "tailor") renderAdminByTailor(body);
  else if (state.adminTab === "week") renderAdminByWeek(body);
  else if (state.adminTab === "stats") renderAdminStats(body);
  else if (state.adminTab === "report") renderAdminReport(body);
}

function flattenColors() {
  // returns array of { sub, item, color } for every color row that has data
  const rows = [];
  state.submissions.forEach((sub) => {
    sub.submission_items.forEach((item) => {
      item.item_colors.forEach((color) => {
        rows.push({ sub, item, color });
      });
    });
  });
  return rows;
}

function renderAdminByTailor(body) {
  const tailorNames = [...new Set(state.submissions.map((s) => s.tailor_name))];
  const filterChips = `
    <div class="filter-bar">
      <div class="chip ${!state.adminFilterTailor ? "active" : ""}" data-filter-tailor="">ทั้งหมด</div>
      ${tailorNames.map((n) => `<div class="chip ${state.adminFilterTailor === n ? "active" : ""}" data-filter-tailor="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join("")}
    </div>
  `;
  let subs = state.submissions;
  if (state.adminFilterTailor) subs = subs.filter((s) => s.tailor_name === state.adminFilterTailor);

  body.innerHTML = filterChips + `<div id="sub-list"></div>`;
  body.querySelectorAll("[data-filter-tailor]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.adminFilterTailor = chip.dataset.filterTailor || null;
      renderAdminScreen();
    });
  });
  document.getElementById("sub-list").innerHTML = subs.map(renderSubCardHtml).join("");
  wireSubCards();
}

function renderAdminByWeek(body) {
  const groups = {};
  state.submissions.forEach((sub) => {
    const key = weekKey(sub.submitted_date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(sub);
  });
  const sortedKeys = Object.keys(groups).sort().reverse();
  body.innerHTML = sortedKeys.map((key) => `
    <div class="report-day-group">
      <div class="report-day-title">${weekLabel(key)} · ${groups[key].length} ใบงาน</div>
      ${groups[key].map(renderSubCardHtml).join("")}
    </div>
  `).join("");
  wireSubCards();
}

function renderSubCardHtml(sub) {
  const itemCount = sub.submission_items.length;
  const colorCount = sub.submission_items.reduce((a, it) => a + it.item_colors.length, 0);
  return `
    <div class="sub-card" data-sub-id="${sub.id}">
      <div class="sub-head">
        <div>
          <div class="sub-tailor">${escapeHtml(sub.tailor_name)}</div>
          <div class="sub-date">${fmtDateThai(sub.submitted_date)} · ${itemCount} รุ่น · ${colorCount} สี</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-expand-sub="${sub.id}">เปิด</button>
      </div>
      <div class="sub-body" id="sub-body-${sub.id}" style="display:none;"></div>
    </div>
  `;
}

function wireSubCards() {
  document.querySelectorAll("[data-expand-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const subId = btn.dataset.expandSub;
      const bodyEl = document.getElementById(`sub-body-${subId}`);
      const isOpen = bodyEl.style.display !== "none";
      if (isOpen) {
        bodyEl.style.display = "none";
        btn.textContent = "เปิด";
      } else {
        const sub = state.submissions.find((s) => s.id === subId);
        bodyEl.innerHTML = renderAdminSubDetailHtml(sub);
        bodyEl.style.display = "block";
        btn.textContent = "ปิด";
        wireAdminSubDetail(sub);
      }
    });
  });
}

function renderAdminSubDetailHtml(sub) {
  let html = "";
  if (sub.note) html += `<div style="margin-bottom:12px;font-size:13px;color:var(--text-dim);background:var(--bg-raised);padding:10px;border-radius:8px;">${escapeHtml(sub.note)}</div>`;
  html += sub.submission_items.map((item) => `
    <div class="item-block">
      <div class="item-block-head">
        <div class="item-style-name">${escapeHtml(item.style_name)}</div>
      </div>
      ${item.item_colors.map((color) => renderAdminColorDetailHtml(sub, item, color)).join("")}
    </div>
  `).join("");
  html += `<button class="btn btn-danger btn-sm btn-block" data-delete-sub="${sub.id}" style="margin-top:6px;">ลบใบงานนี้ทั้งหมด</button>`;
  return html;
}

function renderAdminColorDetailHtml(sub, item, color) {
  const gradeClass = color.current_grade || "";
  const gradeLabel = color.current_grade === "BB" ? `BB${color.bb_round || ""}` : (color.current_grade || "—");
  const imgs = color.item_color_images.map((img) => `
    <div class="img-thumb"><img src="${img.public_url}" data-lightbox="${img.public_url}"></div>
  `).join("");
  let histHtml = "";
  if (color.grade_history && color.grade_history.length) {
    const chips = color.grade_history.map((h) => `<span class="hist-chip">${h.grade === "BB" ? `BB${h.bb_round||""}` : h.grade}</span>`).join("→");
    histHtml = `<div class="grade-history-tag">ประวัติ: ${chips}</div>`;
  }
  return `
    <div class="color-row">
      <div class="color-row-top">
        <span style="flex:1;font-weight:600;font-size:14px;">${escapeHtml(color.color_name) || "—"}</span>
        ${gradeClass ? `<span class="grade-pill ${gradeClass}">${gradeLabel}</span>` : ""}
      </div>
      ${histHtml}
      <div class="img-grid" style="margin-bottom:8px;">${imgs || '<span style="font-size:12px;color:var(--text-faint);">ไม่มีรูป</span>'}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-ghost" style="flex:1;" data-edit-color="${sub.id}|${item.id}|${color.id}">แก้ไข</button>
        <button class="btn btn-sm btn-danger" data-delete-color="${color.id}">ลบสีนี้</button>
      </div>
    </div>
  `;
}


function wireAdminSubDetail(sub) {
  document.querySelectorAll(`[data-lightbox]`).forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.dataset.lightbox));
  });
  const delSubBtn = document.querySelector(`[data-delete-sub="${sub.id}"]`);
  if (delSubBtn) delSubBtn.addEventListener("click", async () => {
    if (!confirm(`ลบใบงานของ "${sub.tailor_name}" วันที่ ${fmtDateThai(sub.submitted_date)} ทั้งหมด? ลบแล้วกู้คืนไม่ได้`)) return;
    await deleteSubmission(sub.id);
  });
  document.querySelectorAll(`[data-delete-color]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("ลบข้อมูลสีนี้และรูปทั้งหมด?")) return;
      await deleteColorRow(btn.dataset.deleteColor);
    });
  });
  document.querySelectorAll(`[data-edit-color]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const [subId, itemId, colorId] = btn.dataset.editColor.split("|");
      openEditColorSheet(subId, itemId, colorId);
    });
  });
}

async function deleteSubmission(subId) {
  setSyncDot("busy");
  try {
    // ลบรูปใน storage ก่อน
    const sub = state.submissions.find((s) => s.id === subId);
    const paths = [];
    sub.submission_items.forEach((it) => it.item_colors.forEach((c) => c.item_color_images.forEach((im) => paths.push(im.storage_path))));
    if (paths.length) await sb.storage.from(STORAGE_BUCKET).remove(paths);
    await sb.from("submissions").delete().eq("id", subId);
    toast("ลบใบงานแล้ว", "ok");
    await loadAllData();
    renderAdminScreen();
  } catch (e) {
    console.error(e);
    toast("ลบไม่สำเร็จ: " + (e.message || e), "err");
  } finally { setSyncDot("live"); }
}

async function deleteColorRow(colorId) {
  setSyncDot("busy");
  try {
    let paths = [];
    state.submissions.forEach((s) => s.submission_items.forEach((it) => it.item_colors.forEach((c) => {
      if (c.id === colorId) paths = c.item_color_images.map((im) => im.storage_path);
    })));
    if (paths.length) await sb.storage.from(STORAGE_BUCKET).remove(paths);
    await sb.from("item_colors").delete().eq("id", colorId);
    toast("ลบแล้ว", "ok");
    await loadAllData();
    renderAdminScreen();
  } catch (e) {
    console.error(e);
    toast("ลบไม่สำเร็จ: " + (e.message || e), "err");
  } finally { setSyncDot("live"); }
}

// ---------- Edit color sheet (admin) ----------
function openEditColorSheet(subId, itemId, colorId) {
  const sub = state.submissions.find((s) => s.id === subId);
  const item = sub.submission_items.find((i) => i.id === itemId);
  const color = item.item_colors.find((c) => c.id === colorId);

  const grades = ["A", "B", "C", "BB"];
  const gradeBtns = grades.map((g) => `<div class="grade-opt ${color.current_grade === g ? "active" : ""}" data-eg="${g}">${g}</div>`).join("");
  const imgs = color.item_color_images.map((img) => `
    <div class="img-thumb" data-img-row="${img.id}">
      <img src="${img.public_url}">
      <div class="img-del" data-edel="${img.id}">✕</div>
    </div>
  `).join("");

  const sheetHtml = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">แก้ไข — ${escapeHtml(item.style_name)}</div>
    <div class="sheet-sub">${escapeHtml(sub.tailor_name)} · ${fmtDateThai(sub.submitted_date)}</div>
    <div class="field">
      <label>สี</label>
      <input class="input" id="edit-color-name" value="${escapeHtml(color.color_name)}">
    </div>
    <div class="field">
      <label>เกรด</label>
      <div class="grade-picker" id="edit-grade-picker">${gradeBtns}</div>
      <div id="edit-bb-wrap"></div>
    </div>
    <div class="field">
      <label>รูปภาพ</label>
      <div class="img-grid" id="edit-img-grid">
        ${imgs}
        <div class="img-add" id="edit-add-img"><span style="font-size:18px;">+</span><span>เพิ่มรูป</span></div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="edit-save-btn">บันทึก</button>
  `;
  showSheet(sheetHtml);

  let editGrade = color.current_grade;
  let editBbRound = color.bb_round;

  function renderBbWrap() {
    const wrap = document.getElementById("edit-bb-wrap");
    if (editGrade === "BB") {
      wrap.innerHTML = `
        <div class="bb-round-row" style="margin-top:8px;">
          <label>แก้ครั้งที่</label>
          <div class="bb-round-stepper">
            <button class="bb-step-btn" id="edit-bb-dec">−</button>
            <span class="bb-round-val" id="edit-bb-val">${editBbRound || 1}</span>
            <button class="bb-step-btn" id="edit-bb-inc">+</button>
          </div>
        </div>`;
      document.getElementById("edit-bb-dec").onclick = () => { editBbRound = Math.max(1, (editBbRound||1)-1); document.getElementById("edit-bb-val").textContent = editBbRound; };
      document.getElementById("edit-bb-inc").onclick = () => { editBbRound = (editBbRound||1)+1; document.getElementById("edit-bb-val").textContent = editBbRound; };
    } else {
      wrap.innerHTML = "";
    }
  }
  renderBbWrap();

  document.querySelectorAll("#edit-grade-picker .grade-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.eg;
      if (g === editGrade) return;
      document.querySelectorAll("#edit-grade-picker .grade-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (editGrade === "C" && g === "BB") { editBbRound = 1; }
      else if (g === "BB") { editBbRound = (editBbRound||0)+1; }
      else { editBbRound = null; }
      editGrade = g;
      renderBbWrap();
    });
  });

  document.querySelectorAll("#edit-img-grid [data-edel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const imgId = btn.dataset.edel;
      if (!confirm("ลบรูปนี้?")) return;
      const imgRow = color.item_color_images.find((i) => i.id === imgId);
      await sb.storage.from(STORAGE_BUCKET).remove([imgRow.storage_path]);
      await sb.from("item_color_images").delete().eq("id", imgId);
      toast("ลบรูปแล้ว", "ok");
      btn.closest(".img-thumb").remove();
      await loadAllData();
    });
  });

  document.getElementById("edit-add-img").addEventListener("click", () => {
    const input = document.getElementById("file-input");
    input.value = "";
    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const compressed = await compressImage(file, 1600, 0.78);
          const path = `${todayISO()}/${uid()}.jpg`;
          await sb.storage.from(STORAGE_BUCKET).upload(path, compressed, { contentType: "image/jpeg" });
          const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
          await sb.from("item_color_images").insert({ item_color_id: color.id, storage_path: path, public_url: pub.publicUrl, sort_order: color.item_color_images.length });
        } catch (err) { console.error(err); toast("อัปโหลดไม่สำเร็จ", "err"); }
      }
      toast("เพิ่มรูปแล้ว", "ok");
      await loadAllData();
      closeSheet();
    };
    input.click();
    // restore default handler after this use
    setTimeout(() => { input.onchange = null; }, 0);
  });

  document.getElementById("edit-save-btn").addEventListener("click", async () => {
    const newName = document.getElementById("edit-color-name").value.trim();
    const history = color.grade_history.slice();
    if (color.current_grade === "C" && editGrade === "BB") {
      history.push({ grade: "C", at: new Date().toISOString() });
    } else if (color.current_grade === "BB" && editGrade === "BB" && editBbRound !== color.bb_round) {
      history.push({ grade: "BB", bb_round: color.bb_round, at: new Date().toISOString() });
    }
    try {
      await sb.from("item_colors").update({
        color_name: newName,
        current_grade: editGrade || "",
        bb_round: editGrade === "BB" ? editBbRound : null,
        grade_history: history,
        updated_at: new Date().toISOString(),
      }).eq("id", color.id);
      toast("บันทึกแล้ว", "ok");
      closeSheet();
      await loadAllData();
      renderAdminScreen();
    } catch (e) {
      console.error(e);
      toast("บันทึกไม่สำเร็จ", "err");
    }
  });
}

// ---------- generic sheet ----------
function showSheet(html) {
  document.getElementById("sheet-content").innerHTML = html;
  document.getElementById("sheet-backdrop").classList.add("show");
}
function closeSheet() {
  document.getElementById("sheet-backdrop").classList.remove("show");
}
document.getElementById("sheet-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "sheet-backdrop") closeSheet();
});


// ============================================================
// ADMIN — STATS TAB
// ============================================================
function renderAdminStats(body) {
  const rows = flattenColors().filter((r) => r.color.current_grade);

  // เกรดไหนเยอะสุดต่อช่าง
  const byTailorGrade = {}; // tailor -> {A,B,C,BB}
  const byTailorStyle = {}; // tailor -> {style: count}
  const styleCounts = {}; // overall style popularity

  rows.forEach(({ sub, item, color }) => {
    const t = sub.tailor_name;
    byTailorGrade[t] = byTailorGrade[t] || { A: 0, B: 0, C: 0, BB: 0 };
    byTailorGrade[t][color.current_grade] = (byTailorGrade[t][color.current_grade] || 0) + 1;

    byTailorStyle[t] = byTailorStyle[t] || {};
    byTailorStyle[t][item.style_name] = (byTailorStyle[t][item.style_name] || 0) + 1;

    styleCounts[item.style_name] = (styleCounts[item.style_name] || 0) + 1;
  });

  const totalByGrade = { A: 0, B: 0, C: 0, BB: 0 };
  rows.forEach((r) => { totalByGrade[r.color.current_grade]++; });

  // overview stat cards
  let html = `<div class="stat-grid">`;
  ["A", "B", "C", "BB"].forEach((g) => {
    html += `
      <div class="stat-card">
        <div class="stat-label">เกรด ${g}</div>
        <div class="stat-value" style="color:var(--grade-${g.toLowerCase()})">${totalByGrade[g]}</div>
        <div class="stat-sub">รายการทั้งหมด</div>
      </div>`;
  });
  html += `</div>`;

  // per-tailor: who has highest grade of each
  html += `<div class="card"><div class="section-label">ช่างไหนได้เกรดอะไรเยอะสุด</div>`;
  ["A", "B", "C", "BB"].forEach((g) => {
    let topTailor = null, topCount = 0;
    Object.entries(byTailorGrade).forEach(([t, counts]) => {
      if ((counts[g] || 0) > topCount) { topCount = counts[g]; topTailor = t; }
    });
    if (topTailor) {
      html += `
        <div class="bar-row">
          <span class="bar-name" style="width:auto;flex:1;">เกรด ${g} เยอะสุด</span>
          <span style="font-weight:600;font-size:13px;">${escapeHtml(topTailor)}</span>
          <span class="bar-num" style="color:var(--grade-${g.toLowerCase()});font-weight:700;">${topCount}</span>
        </div>`;
    }
  });
  html += `</div>`;

  // per-tailor breakdown bars
  html += `<div class="card"><div class="section-label">สัดส่วนเกรดของช่างแต่ละคน</div>`;
  Object.entries(byTailorGrade).forEach(([t, counts]) => {
    const total = counts.A + counts.B + counts.C + counts.BB;
    html += `<div style="margin-bottom:14px;">
      <div style="font-size:13.5px;font-weight:600;margin-bottom:7px;">${escapeHtml(t)} <span style="color:var(--text-faint);font-weight:400;">(${total} รายการ)</span></div>`;
    ["A", "B", "C", "BB"].forEach((g) => {
      const pct = total ? (counts[g] / total * 100) : 0;
      html += `
        <div class="bar-row">
          <span class="bar-name">${g}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--grade-${g.toLowerCase()});"></div></div>
          <span class="bar-num">${counts[g]}</span>
        </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;

  // style popularity overall
  html += `<div class="card"><div class="section-label">รุ่นที่เย็บเยอะสุด (รวมทุกช่าง)</div>`;
  const topStyles = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxStyleCount = topStyles.length ? topStyles[0][1] : 1;
  topStyles.forEach(([style, count]) => {
    html += `
      <div class="bar-row">
        <span class="bar-name" style="width:120px;">${escapeHtml(style)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${count/maxStyleCount*100}%;background:var(--accent);"></div></div>
        <span class="bar-num">${count}</span>
      </div>`;
  });
  html += `</div>`;

  // per tailor: top style
  html += `<div class="card"><div class="section-label">ช่างไหนเย็บรุ่นอะไรเยอะสุด</div>`;
  Object.entries(byTailorStyle).forEach(([t, styles]) => {
    const top = Object.entries(styles).sort((a, b) => b[1] - a[1])[0];
    html += `
      <div class="bar-row">
        <span class="bar-name" style="width:auto;flex:1;">${escapeHtml(t)}</span>
        <span style="font-size:13px;color:var(--text-dim);">${escapeHtml(top[0])}</span>
        <span class="bar-num">${top[1]}</span>
      </div>`;
  });
  html += `</div>`;

  body.innerHTML = html;
}

// ============================================================
// ADMIN — DAILY REPORT TAB
// ============================================================
function renderAdminReport(body) {
  const dates = [...new Set(state.submissions.map((s) => s.submitted_date))].sort().reverse();
  if (dates.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="es-title">ไม่มีข้อมูล</div></div>`;
    return;
  }
  const dateChips = `
    <div class="filter-bar">
      ${dates.slice(0, 14).map((dt) => `<div class="chip ${state._reportDate === dt || (!state._reportDate && dt === dates[0]) ? "active" : ""}" data-report-date="${dt}">${fmtDateShort(dt)}</div>`).join("")}
    </div>
  `;
  const activeDate = state._reportDate || dates[0];
  const subsForDate = state.submissions.filter((s) => s.submitted_date === activeDate);

  let html = dateChips;
  html += `<div class="report-day-title" style="font-size:14px;color:var(--text);margin-bottom:14px;">รายงานวันที่ ${fmtDateThai(activeDate)}</div>`;

  if (subsForDate.length === 0) {
    html += `<div class="empty-state"><div class="es-sub">ไม่มีงานส่งวันนี้</div></div>`;
  } else {
    subsForDate.forEach((sub) => {
      html += `<div class="report-day-group"><div class="report-day-title">${escapeHtml(sub.tailor_name)}</div>`;
      sub.submission_items.forEach((item) => {
        item.item_colors.forEach((color) => {
          const thumb = color.item_color_images[0]?.public_url || "";
          const gradeLabel = color.current_grade === "BB" ? `BB${color.bb_round||""}` : (color.current_grade || "—");
          html += `
            <div class="report-row">
              ${thumb ? `<img class="report-thumb" src="${thumb}" data-lightbox="${thumb}">` : `<div class="report-thumb"></div>`}
              <div class="report-info">
                <div class="report-style">${escapeHtml(item.style_name)}</div>
                <div class="report-color">${escapeHtml(color.color_name) || "—"} · ${color.item_color_images.length} รูป</div>
              </div>
              ${color.current_grade ? `<span class="grade-pill ${color.current_grade}">${gradeLabel}</span>` : ""}
            </div>`;
        });
      });
      html += `</div>`;
    });
  }

  body.innerHTML = html;
  body.querySelectorAll("[data-report-date]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state._reportDate = chip.dataset.reportDate;
      renderAdminScreen();
    });
  });
  body.querySelectorAll("[data-lightbox]").forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.dataset.lightbox));
  });
}


// ============================================================
// BOOTSTRAP
// ============================================================
document.getElementById("tailor-logout").addEventListener("click", () => {
  if (state.draft && (state.draft.tailor_name || state.draft.items.length)) {
    if (!confirm("ออกจากระบบ? งานที่กรอกค้างไว้ (ยังไม่ส่ง) จะหายไป")) return;
  }
  logout();
});
document.getElementById("admin-logout").addEventListener("click", () => {
  logout();
});

async function boot() {
  const loadingScreen = document.getElementById("loading-screen");
  const ok = initSupabase();
  if (!ok) {
    loadingScreen.innerHTML = `
      <div style="max-width:320px;text-align:center;padding:20px;">
        <div style="font-weight:700;margin-bottom:10px;font-size:16px;">ยังไม่ได้ตั้งค่า Supabase</div>
        <div style="color:var(--text-dim);font-size:13.5px;line-height:1.6;">กรุณาใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ที่ด้านบนของไฟล์ app.js</div>
      </div>`;
    return;
  }
  renderLoginScreen();
  try {
    await loadAllData();
    subscribeRealtime();
  } catch (e) {
    console.error(e);
  }
  loadingScreen.classList.add("hide");
  const wasLoggedIn = checkSavedLogin();
  if (!wasLoggedIn) showScreen("login-screen");
}

boot();
