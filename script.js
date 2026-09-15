/* ============================================================
   덩기덕 404 스케줄러 — 설정
   구글 시트를 "링크가 있는 모든 사용자: 뷰어"로 공유해두면
   아래 URL로 실시간 CSV를 읽어옵니다 (Publish to web 불필요).

   1) 시트 주소창의 .../d/  와  /edit 사이 긴 문자열이 SHEET_ID
   2) 탭 이름을 그대로 씁니다 (하단 탭에 표시된 이름과 정확히 일치해야 함)
   ============================================================ */
const CONFIG = {
  SHEET_ID: "145ANufllVVP-m2ffsZcjQRLIndPQ6PCs3d_aIfzzH2k",
  SCHEDULE_SHEET: "일정",       // 일정표 탭 이름
  GAMES_SHEET: "게임아카이브",   // 게임 아카이브 탭 이름
  TODO_SHEET: "메모",           // 할일 메모 탭 이름

  // 우측 상단 "System Error" 팝업 문구 — 자유롭게 수정하세요
  ERROR_TITLE: "System Error",
  ERROR_MESSAGE: "Error 404: <b>일정</b> not found.<br>오늘도 방송 준비 중...",
  ERROR_OK_TEXT: "확인",
};

/* 시트 컬럼 규격 (1행은 헤더, 2행부터 데이터 — 헤더 행이 꼭 있어야 합니다!)
   [스케줄 탭]  A:date(YYYY-MM-DD)  B:title  C:tag(yellow/blue/red/green/gray 또는 #ffaa00 같은 컬러 코드)
   [게임 탭]    A:title  B:rating(1~5)  C:note  D:tag(옵션)
   [메모 탭]    A: 첫 행은 아무 헤더(예: item), 2행부터 한 줄에 할일 하나씩
*/

function csvUrl(sheetName){
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

// 아주 단순한 CSV 파서 (따옴표로 감싼 콤마/줄바꿈까지 처리)
function parseCSV(text){
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQuotes){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ','){ row.push(field); field = ""; }
      else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}

async function fetchSheet(sheetName){
  const res = await fetch(csvUrl(sheetName), { cache: "no-store" });
  if (!res.ok) throw new Error("sheet fetch failed: " + res.status);
  const text = await res.text();
  const rows = parseCSV(text);
  return rows.slice(1); // drop header
}

/* ---------------- clock ---------------- */
function tickClock(){
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = ((h % 12) || 12);
  const label = `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
  const c1 = document.getElementById("clock");
  if (c1) c1.textContent = label;
}
tickClock();
setInterval(tickClock, 15000);

/* ---------------- window switching (독립 창: 하나 열어도 다른 창은 안 닫힘) ---------------- */
function updateTaskbarItem(id){
  const win = document.getElementById(id);
  const item = document.querySelector('.taskitem[data-win="' + id + '"]');
  if (!win || !item) return;
  item.classList.toggle("hidden", win.classList.contains("hidden"));
  item.classList.toggle("active", !win.classList.contains("hidden") && Number(win.style.zIndex || 0) === zTop);
}
function refreshAllTaskbarItems(){
  document.querySelectorAll(".taskitem[data-win]").forEach(item => updateTaskbarItem(item.dataset.win));
}
function showWindow(id){
  const win = document.getElementById(id);
  if (!win) return;
  win.classList.remove("hidden");
  win.style.zIndex = ++zTop;
  refreshAllTaskbarItems();
}
document.getElementById("open-schedule").onclick = () => { if (justDragged) return; showWindow("win-schedule"); };
document.getElementById("open-archive").onclick = () => { if (justDragged) return; showWindow("win-archive"); };
document.getElementById("open-mine").onclick = () => { if (justDragged) return; showWindow("win-mine"); };
document.getElementById("open-inet").onclick = () => { if (justDragged) return; renderInetHome(); showWindow("win-inet"); };
document.getElementById("goto-archive").onclick = () => showWindow("win-archive");
document.getElementById("goto-schedule").onclick = () => showWindow("win-schedule");
document.querySelectorAll("[data-close]").forEach(btn=>{
  btn.onclick = () => {
    btn.closest(".window").classList.add("hidden");
    refreshAllTaskbarItems();
  };
});
document.querySelectorAll(".taskitem[data-win]").forEach(item=>{
  item.onclick = () => showWindow(item.dataset.win); // 항상 해당 창을 맨 위로
});
document.querySelectorAll(".close-toast").forEach(btn=>{
  btn.onclick = () => document.getElementById("err-toast").classList.add("hidden");
});

/* ---------------- calendar ---------------- */
let viewYear, viewMonth; // 0-indexed month
let scheduleByDate = {}; // "YYYY-MM-DD" -> [{title,tag}]

/* 태그 컬러: 시트에 yellow/blue/red/green/gray 같은 이름 대신
   #ffaa00 같은 컬러 코드(hex)를 적어도 그 색 그대로 적용됨 */
function normalizeHex(v){
  if (!v) return null;
  let s = String(v).trim();
  if (/^#?[0-9a-fA-F]{3}$/.test(s) || /^#?[0-9a-fA-F]{6}$/.test(s)){
    if (!s.startsWith("#")) s = "#" + s;
    return s;
  }
  return null;
}
function hexToRgb(hex){
  let h = hex.replace("#","");
  if (h.length === 3) h = h.split("").map(c=>c+c).join("");
  const num = parseInt(h,16);
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function contrastText(hex){
  const { r,g,b } = hexToRgb(hex);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 150 ? "#1a1a1a" : "#ffffff";
}
function applyTagColor(el, tagValue){
  const hex = normalizeHex(tagValue);
  if (hex){
    el.className = "cal-tag";
    el.style.background = hex;
    el.style.borderColor = "rgba(0,0,0,.45)";
    el.style.color = contrastText(hex);
  } else {
    el.className = "cal-tag tag-" + (tagValue || "gray").toLowerCase();
    el.style.background = ""; el.style.borderColor = ""; el.style.color = "";
  }
}

function ymd(y,m,d){
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function renderCalendar(){
  const grid = document.getElementById("cal-grid");
  const label = document.getElementById("month-label");
  label.textContent = `${viewYear}년 ${String(viewMonth+1).padStart(2,"0")}월`;
  grid.innerHTML = "";

  const first = new Date(viewYear, viewMonth, 1);
  const startPad = first.getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  for (let i=0; i<startPad; i++){
    const cell = document.createElement("div");
    cell.className = "cal-cell pad";
    grid.appendChild(cell);
  }
  for (let d=1; d<=daysInMonth; d++){
    const cell = document.createElement("div");
    const key = ymd(viewYear, viewMonth, d);
    const isToday = isThisMonth && today.getDate() === d;
    cell.className = "cal-cell" + (isToday ? " today" : "");
    cell.innerHTML = `${d}` + (isToday ? `<div class="today-badge">오늘</div>` : "");
    const entries = scheduleByDate[key] || [];
    entries.forEach(e=>{
      const tag = document.createElement("div");
      applyTagColor(tag, e.tag);
      tag.textContent = e.title;
      cell.appendChild(tag);
    });
    grid.appendChild(cell);
  }
  const totalCells = startPad + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i=0; i<trailing; i++){
    const cell = document.createElement("div");
    cell.className = "cal-cell pad";
    grid.appendChild(cell);
  }
}

document.getElementById("prev-month").onclick = () => {
  viewMonth--; if (viewMonth < 0){ viewMonth = 11; viewYear--; }
  renderCalendar();
};
document.getElementById("next-month").onclick = () => {
  viewMonth++; if (viewMonth > 11){ viewMonth = 0; viewYear++; }
  renderCalendar();
};

/* ---------------- loading cursor (모래시계) ---------------- */
let pendingLoads = 0;
function beginLoad(){
  pendingLoads++;
  document.body.classList.add("wait-cursor");
}
function endLoad(){
  pendingLoads = Math.max(0, pendingLoads - 1);
  if (pendingLoads === 0) document.body.classList.remove("wait-cursor");
}

/* ---------------- data loading ---------------- */
async function loadSchedule(){
  const status = document.getElementById("status-pill");
  beginLoad();
  try {
    const rows = await fetchSheet(CONFIG.SCHEDULE_SHEET);
    scheduleByDate = {};
    rows.forEach(r => {
      const [date, title, tag] = r;
      if (!date || !title) return;
      const key = date.trim();
      if (!scheduleByDate[key]) scheduleByDate[key] = [];
      scheduleByDate[key].push({ title: title.trim(), tag: (tag||"gray").trim() });
    });
    status.textContent = "STATUS: LIVE_SOON";
    renderCalendar();
  } catch(err){
    status.textContent = "STATUS: LOAD_ERROR";
    console.error(err);
  } finally {
    endLoad();
  }
}

async function loadTodo(){
  const body = document.getElementById("todo-body");
  beginLoad();
  try {
    const rows = await fetchSheet(CONFIG.TODO_SHEET);
    const items = rows.map(r => r[0]).filter(Boolean);
    body.textContent = items.length
      ? items.map(i => "> " + i).join("\n")
      : "(할일 없음)";
  } catch(err){
    body.textContent = "메모를 불러오지 못했습니다.";
    console.error(err);
  } finally {
    endLoad();
  }
}

const STAR_MAP = { 1:"★☆☆☆☆", 2:"★★☆☆☆", 3:"★★★☆☆", 4:"★★★★☆", 5:"★★★★★" };
// 이 점수 이상이면 "추천"(초록), 미만이면 "비추천"(빨강)
const RECOMMEND_THRESHOLD = 4;

const THUMB_UP_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7 10v10H4V10h3zm3.5 10h7.2c.9 0 1.68-.6 1.92-1.46l1.9-6.7A2 2 0 0 0 19.6 9.3H14l.7-4.2c.15-.95-.6-1.8-1.56-1.8-.5 0-.96.27-1.2.7L8.5 10.4V20c.32.4.9 0 2 0z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const THUMB_DOWN_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M17 14V4h3v10h-3zm-3.5-10H6.3c-.9 0-1.68.6-1.92 1.46l-1.9 6.7A2 2 0 0 0 4.4 14.7H10l-.7 4.2c-.15.95.6 1.8 1.56 1.8.5 0 .96-.27 1.2-.7l3.44-6.4V4c-.32-.4-.9 0-2 0z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

async function loadGames(){
  const grid = document.getElementById("game-grid");
  const count = document.getElementById("game-count");
  beginLoad();
  try {
    const rows = await fetchSheet(CONFIG.GAMES_SHEET);
    grid.innerHTML = "";
    rows.forEach(r=>{
      const [title, ratingRaw, note, tag] = r;
      if (!title) return;
      const rating = Math.max(1, Math.min(5, parseInt(ratingRaw,10) || 3));
      const recommended = rating >= RECOMMEND_THRESHOLD;
      const card = document.createElement("div");
      card.className = "gcard bevel-out";
      card.innerHTML = `
        <div class="rec ${recommended ? "up" : "down"}">
          ${recommended ? THUMB_UP_SVG : THUMB_DOWN_SVG}
          <div class="rec-label">${recommended ? "추천" : "비추천"}</div>
        </div>
        <div class="gbody">
          <div class="gtop">
            <div class="gtitle">${escapeHtml(title)}</div>
            <div class="gstars">${STAR_MAP[rating]}</div>
            ${tag ? `<div class="gtag">${escapeHtml(tag)}</div>` : ""}
          </div>
          <div class="gnote">${escapeHtml(note||"")}</div>
        </div>`;
      grid.appendChild(card);
    });
    count.textContent = `전체 ${rows.length}개 게임 기록됨`;
  } catch(err){
    grid.innerHTML = "불러오지 못했습니다.";
    console.error(err);
  } finally {
    endLoad();
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

/* ---------------- drag & resize (진짜 PC처럼) ---------------- */
let justDragged = false; // 드래그 직후 클릭(=창 열기/링크 이동)을 한 번 막기 위한 플래그
let zTop = 10;

function markDragged(){
  justDragged = true;
  // 모바일은 touchend 이후 합성 click 이벤트가 한 박자 늦게 오기 때문에
  // 0ms로 풀어버리면 click이 도착하기 전에 플래그가 꺼져서 링크가 눌려버림
  setTimeout(() => { justDragged = false; }, 400);
}

// 아이콘: 자유롭게 옮기기만 함 (위치는 이 브라우저에 저장됨)
function makeIconDraggable(el){
  if (!el) return;
  const key = "404-icon-pos:" + (el.id || el.textContent);
  let dragging = false, startX, startY, startLeft, startTop, moved = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved){
      el.style.left = saved.left;
      el.style.top = saved.top;
    }
  } catch(e){}

  function onDown(e){
    dragging = true; moved = false;
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();
    startLeft = rect.left - parentRect.left;
    startTop = rect.top - parentRect.top;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive:false });
    document.addEventListener("touchend", onUp);
  }
  function onMove(e){
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - startX, dy = p.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (moved && e.cancelable) e.preventDefault();
    el.style.left = (startLeft + dx) + "px";
    el.style.top = (startTop + dy) + "px";
  }
  function onUp(){
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
    if (moved){
      markDragged();
      try {
        localStorage.setItem(key, JSON.stringify({ left: el.style.left, top: el.style.top }));
      } catch(e){}
    }
  }
  el.addEventListener("mousedown", onDown);
  el.addEventListener("touchstart", onDown, { passive:true });
}

// 에러 토스트: 제목줄 잡고 드래그 (닫기 버튼은 제외), 위치는 이 브라우저에 저장됨
function makeToastDraggable(el){
  if (!el) return;
  const handle = el.querySelector(".titlebar");
  if (!handle) return;
  const key = "404-toast-pos";
  let dragging = false, startX, startY, startLeft, startTop, moved = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved){
      el.style.left = saved.left;
      el.style.top = saved.top;
      el.classList.add("dragged");
    }
  } catch(e){}

  function toPixelPosition(){
    if (el.classList.contains("dragged")) return;
    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();
    el.style.left = (rect.left - parentRect.left) + "px";
    el.style.top = (rect.top - parentRect.top) + "px";
    el.classList.add("dragged");
  }

  function onDown(e){
    if (e.target.closest(".wbtn")) return; // 닫기 버튼은 제외
    toPixelPosition();
    dragging = true; moved = false;
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive:false });
    document.addEventListener("touchend", onUp);
  }
  function onMove(e){
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - startX, dy = p.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (moved && e.cancelable) e.preventDefault();
    el.style.left = (startLeft + dx) + "px";
    el.style.top = (startTop + dy) + "px";
  }
  function onUp(){
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
    if (moved){
      markDragged();
      try {
        localStorage.setItem(key, JSON.stringify({ left: el.style.left, top: el.style.top }));
      } catch(e){}
    }
  }
  handle.addEventListener("mousedown", onDown);
  handle.addEventListener("touchstart", onDown, { passive:true });
}

// 창: 제목줄 드래그로 이동 + 우측 하단 모서리로 크기 조절, 위치/크기는 이 브라우저에 저장됨
function makeWindowInteractive(win){
  if (!win) return;
  const id = win.id;
  const posKey = "404-win-pos:" + id;
  const sizeKey = "404-win-size:" + id;
  const titlebar = win.querySelector(".titlebar");
  const handle = win.querySelector('[data-resize="' + id + '"]');

  function toPixelPosition(){
    if (win.classList.contains("dragged")) return;
    const rect = win.getBoundingClientRect();
    const parentRect = win.parentElement.getBoundingClientRect();
    win.style.left = (rect.left - parentRect.left) + "px";
    win.style.top = (rect.top - parentRect.top) + "px";
    win.classList.add("dragged");
  }

  // 저장된 위치/크기 복원
  try {
    const savedPos = JSON.parse(localStorage.getItem(posKey));
    if (savedPos){
      win.style.left = savedPos.left;
      win.style.top = savedPos.top;
      win.classList.add("dragged");
    }
    const savedSize = JSON.parse(localStorage.getItem(sizeKey));
    if (savedSize){
      win.style.width = savedSize.width;
      win.style.height = savedSize.height;
    }
  } catch(e){}

  // 이동
  let dragging = false, startX, startY, startLeft, startTop, moved = false;
  function onDownMove(e){
    if (e.target.closest(".wctl")) return; // 최소화/최대화/닫기 버튼은 제외
    toPixelPosition();
    dragging = true; moved = false;
    win.style.zIndex = ++zTop;
    if (typeof refreshAllTaskbarItems === "function") refreshAllTaskbarItems();
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    startLeft = parseFloat(win.style.left) || 0;
    startTop = parseFloat(win.style.top) || 0;
    document.addEventListener("mousemove", onMoveMove);
    document.addEventListener("mouseup", onUpMove);
    document.addEventListener("touchmove", onMoveMove, { passive:false });
    document.addEventListener("touchend", onUpMove);
  }
  function onMoveMove(e){
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - startX, dy = p.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (moved && e.cancelable) e.preventDefault();
    win.style.left = (startLeft + dx) + "px";
    win.style.top = (startTop + dy) + "px";
  }
  function onUpMove(){
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMoveMove);
    document.removeEventListener("mouseup", onUpMove);
    document.removeEventListener("touchmove", onMoveMove);
    document.removeEventListener("touchend", onUpMove);
    if (moved){
      markDragged();
      try {
        localStorage.setItem(posKey, JSON.stringify({ left: win.style.left, top: win.style.top }));
      } catch(e){}
    }
  }
  if (titlebar){
    titlebar.addEventListener("mousedown", onDownMove);
    titlebar.addEventListener("touchstart", onDownMove, { passive:true });
  }

  // 크기 조절
  let resizing = false, rStartX, rStartY, rStartW, rStartH;
  function onDownResize(e){
    toPixelPosition();
    resizing = true;
    win.style.zIndex = ++zTop;
    const p = e.touches ? e.touches[0] : e;
    rStartX = p.clientX; rStartY = p.clientY;
    const rect = win.getBoundingClientRect();
    rStartW = rect.width; rStartH = rect.height;
    document.addEventListener("mousemove", onMoveResize);
    document.addEventListener("mouseup", onUpResize);
    document.addEventListener("touchmove", onMoveResize, { passive:false });
    document.addEventListener("touchend", onUpResize);
    e.stopPropagation();
  }
  function onMoveResize(e){
    if (!resizing) return;
    if (e.cancelable) e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    const dw = p.clientX - rStartX, dh = p.clientY - rStartY;
    win.style.width = Math.max(320, rStartW + dw) + "px";
    win.style.height = Math.max(260, rStartH + dh) + "px";
  }
  function onUpResize(){
    if (!resizing) return;
    resizing = false;
    document.removeEventListener("mousemove", onMoveResize);
    document.removeEventListener("mouseup", onUpResize);
    document.removeEventListener("touchmove", onMoveResize);
    document.removeEventListener("touchend", onUpResize);
    try {
      localStorage.setItem(sizeKey, JSON.stringify({ width: win.style.width, height: win.style.height }));
    } catch(e){}
  }
  if (handle){
    handle.addEventListener("mousedown", onDownResize);
    handle.addEventListener("touchstart", onDownResize, { passive:false });
  }
}

function setupDragAndResize(){
  ["open-schedule","open-archive","open-mine","open-inet","icon-chzzk","icon-cafe","icon-x","icon-youtube"].forEach(id=>{
    makeIconDraggable(document.getElementById(id));
  });
  // 링크 아이콘은 드래그 직후엔 새 탭 이동을 막음
  document.querySelectorAll("a.dicon").forEach(a=>{
    a.addEventListener("click", e => { if (justDragged) e.preventDefault(); });
  });
  makeWindowInteractive(document.getElementById("win-schedule"));
  makeWindowInteractive(document.getElementById("win-archive"));
  makeWindowInteractive(document.getElementById("win-mine"));
  makeWindowInteractive(document.getElementById("win-inet"));
  makeToastDraggable(document.getElementById("err-toast"));
}

/* ---------------- init ---------------- */
function applyErrorToastText(){
  const t = document.getElementById("err-title");
  const m = document.getElementById("err-msg");
  const o = document.getElementById("err-ok");
  if (t) t.textContent = CONFIG.ERROR_TITLE;
  if (m) m.innerHTML = CONFIG.ERROR_MESSAGE;
  if (o) o.textContent = CONFIG.ERROR_OK_TEXT;
}

/* ---------------- retro boot screen ---------------- */
const BOOT_LINES = [
  "404 SYSTEM BIOS v4.04",
  "Copyright (C) Rabbi",
  "",
  "CPU: 404-DUCK Processor",
  "Detecting IDE drives... OK",
  "Memory Test: 640K OK",
  "",
  "Loading 404_SCHEDULER.EXE...",
  "Loading GAME_ARCHIVE.EXE...",
  "Initializing desktop..."
];

function runBootSequence(){
  const screen = document.getElementById("boot-screen");
  const linesEl = document.getElementById("boot-lines");
  const fill = document.getElementById("boot-bar-fill");
  if (!screen || !linesEl){ return; }

  let i = 0;
  let finished = false;

  function finish(){
    if (finished) return;
    finished = true;
    screen.classList.add("hide");
    setTimeout(() => { if (screen.parentNode) screen.remove(); }, 500);
    document.removeEventListener("keydown", finish);
    document.removeEventListener("touchstart", finish);
    screen.removeEventListener("click", finish);
  }

  function showNext(){
    if (i >= BOOT_LINES.length){
      if (fill) fill.style.width = "100%";
      setTimeout(finish, 300);
      return;
    }
    const text = BOOT_LINES[i];
    const div = document.createElement("div");
    div.className = "boot-line" + (text === "" ? " blank" : "");
    div.textContent = text;
    linesEl.appendChild(div);
    i++;
    if (fill) fill.style.width = Math.round((i / BOOT_LINES.length) * 100) + "%";
    setTimeout(showNext, text === "" ? 60 : 150 + Math.random() * 110);
  }
  showNext();

  document.addEventListener("keydown", finish);
  document.addEventListener("touchstart", finish, { passive:true });
  screen.addEventListener("click", finish);
  setTimeout(finish, 4500); // safety timeout
}

/* ---------------- 미니게임: 지뢰찾기 ---------------- */
const MINE_COLS = 9, MINE_ROWS = 9, MINE_COUNT = 10;
let mineState = null; // { grid, opened, flagged, over, won, timer, timerId }

function mineIndex(r, c){ return r * MINE_COLS + c; }

function mineNeighbors(r, c){
  const out = [];
  for (let dr = -1; dr <= 1; dr++){
    for (let dc = -1; dc <= 1; dc++){
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < MINE_ROWS && nc >= 0 && nc < MINE_COLS) out.push([nr, nc]);
    }
  }
  return out;
}

function mineBuildGrid(safeR, safeC){
  const total = MINE_COLS * MINE_ROWS;
  const mines = new Set();
  while (mines.size < MINE_COUNT){
    const idx = Math.floor(Math.random() * total);
    const r = Math.floor(idx / MINE_COLS), c = idx % MINE_COLS;
    if (r === safeR && c === safeC) continue; // 첫 클릭은 항상 안전
    mines.add(idx);
  }
  const grid = [];
  for (let r = 0; r < MINE_ROWS; r++){
    const row = [];
    for (let c = 0; c < MINE_COLS; c++){
      row.push({ mine: mines.has(mineIndex(r, c)), n: 0 });
    }
    grid.push(row);
  }
  for (let r = 0; r < MINE_ROWS; r++){
    for (let c = 0; c < MINE_COLS; c++){
      if (grid[r][c].mine) continue;
      grid[r][c].n = mineNeighbors(r, c).filter(([nr, nc]) => grid[nr][nc].mine).length;
    }
  }
  return grid;
}

function mineStopTimer(){
  if (mineState && mineState.timerId){ clearInterval(mineState.timerId); mineState.timerId = null; }
}

function mineUpdateFlagCount(){
  const el = document.getElementById("mine-flags");
  if (!el || !mineState) return;
  el.textContent = "🚩 " + Math.max(0, MINE_COUNT - mineState.flagged.size);
}

function mineSetFace(face){
  const el = document.getElementById("mine-face");
  if (el) el.textContent = face;
}

function mineRender(){
  const board = document.getElementById("mine-board");
  if (!board || !mineState) return;
  board.innerHTML = "";
  for (let r = 0; r < MINE_ROWS; r++){
    for (let c = 0; c < MINE_COLS; c++){
      const cell = document.createElement("div");
      cell.className = "mine-cell";
      const key = mineIndex(r, c);
      const opened = mineState.opened.has(key);
      const flagged = mineState.flagged.has(key);
      const data = mineState.grid ? mineState.grid[r][c] : null;
      if (opened && data){
        cell.classList.add("open");
        if (data.mine){
          cell.classList.add("mine");
          cell.textContent = "💣";
        } else if (data.n > 0){
          cell.dataset.n = data.n;
          cell.textContent = data.n;
        }
      } else if (flagged){
        cell.classList.add("flag");
        cell.textContent = "🚩";
      }
      cell.addEventListener("click", () => mineHandleOpen(r, c));
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); mineHandleFlag(r, c); });
      board.appendChild(cell);
    }
  }
  mineUpdateFlagCount();
}

function mineFloodOpen(r, c){
  const stack = [[r, c]];
  while (stack.length){
    const [cr, cc] = stack.pop();
    const key = mineIndex(cr, cc);
    if (mineState.opened.has(key) || mineState.flagged.has(key)) continue;
    mineState.opened.add(key);
    const cell = mineState.grid[cr][cc];
    if (cell.n === 0 && !cell.mine){
      mineNeighbors(cr, cc).forEach(([nr, nc]) => {
        if (!mineState.opened.has(mineIndex(nr, nc))) stack.push([nr, nc]);
      });
    }
  }
}

function mineCheckWin(){
  const total = MINE_COLS * MINE_ROWS;
  return mineState.opened.size === total - MINE_COUNT;
}

function mineHandleOpen(r, c){
  if (!mineState || mineState.over) return;
  const key = mineIndex(r, c);
  if (mineState.flagged.has(key)) return;

  if (!mineState.grid){
    mineState.grid = mineBuildGrid(r, c);
    mineState.timer = 0;
    const timerEl = document.getElementById("mine-timer");
    mineState.timerId = setInterval(() => {
      mineState.timer++;
      if (timerEl) timerEl.textContent = "⏱ " + mineState.timer;
    }, 1000);
  }

  const cellData = mineState.grid[r][c];
  if (cellData.mine){
    mineState.opened.add(key);
    mineState.over = true;
    mineStopTimer();
    mineSetFace("😵");
    for (let rr = 0; rr < MINE_ROWS; rr++){
      for (let cc = 0; cc < MINE_COLS; cc++){
        if (mineState.grid[rr][cc].mine) mineState.opened.add(mineIndex(rr, cc));
      }
    }
    mineRender();
    return;
  }

  mineFloodOpen(r, c);
  if (mineCheckWin()){
    mineState.over = true;
    mineState.won = true;
    mineStopTimer();
    mineSetFace("😎");
  }
  mineRender();
}

function mineHandleFlag(r, c){
  if (!mineState || mineState.over) return;
  const key = mineIndex(r, c);
  if (mineState.opened.has(key)) return;
  if (mineState.flagged.has(key)) mineState.flagged.delete(key);
  else mineState.flagged.add(key);
  mineRender();
}

function mineReset(){
  mineStopTimer();
  mineState = { grid: null, opened: new Set(), flagged: new Set(), over: false, won: false, timer: 0, timerId: null };
  mineSetFace("🙂");
  const timerEl = document.getElementById("mine-timer");
  if (timerEl) timerEl.textContent = "⏱ 0";
  mineRender();
}

function setupMinesweeper(){
  const face = document.getElementById("mine-face");
  if (face) face.onclick = mineReset;
  mineReset();
}

/* ---------------- 바탕화면 연타 이스터에그: 화면 금가고 결국 박살 ---------------- */
const CRACK_LIMIT = 14;
let crackCount = 0;
let crackBusy = false;

function crackStroke(d){
  return `<path d="${d}" stroke="rgba(0,0,0,.55)" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` +
         `<path d="${d}" stroke="rgba(255,255,255,.85)" stroke-width="0.6" fill="none" stroke-linejoin="round"/>`;
}

// 유리 깨진 느낌: 중심에서 뻗는 불규칙한 금 + 끝에서 갈라지는 잔금 (완전 대칭 거미줄 지양)
function crackMarkSvg(size){
  const cx = size / 2, cy = size / 2;
  const legCount = 6 + Math.floor(Math.random() * 5);
  const rMax = size / 2;
  const angles = [];
  for (let i = 0; i < legCount; i++){
    angles.push((Math.PI * 2 * i) / legCount + (Math.random() - 0.5) * 0.9);
  }
  let paths = "";
  const tips = [];

  angles.forEach(angle => {
    const legLen = rMax * (0.55 + Math.random() * 0.45); // 다리마다 길이 다르게
    const segs = 3 + Math.floor(Math.random() * 2);
    let d = `M ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    let px = cx, py = cy;
    for (let s = 0; s < segs; s++){
      const len = legLen * ((s + 1) / segs);
      const jitter = (Math.random() - 0.5) * size * 0.16;
      const perp = angle + Math.PI / 2;
      px = cx + Math.cos(angle) * len + Math.cos(perp) * jitter;
      py = cy + Math.sin(angle) * len + Math.sin(perp) * jitter;
      d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
    }
    paths += crackStroke(d);
    tips.push([px, py, angle]);

    // 다리 끝에서 짧게 갈라지는 잔금 1~2개
    const branches = 1 + Math.floor(Math.random() * 2);
    for (let b = 0; b < branches; b++){
      const branchAngle = angle + (Math.random() - 0.5) * 1.6;
      const branchLen = legLen * (0.2 + Math.random() * 0.25);
      const bx = px + Math.cos(branchAngle) * branchLen;
      const by = py + Math.sin(branchAngle) * branchLen;
      paths += crackStroke(`M ${px.toFixed(1)} ${py.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`);
    }
  });

  // 인접한 다리끼리만 가끔 잇는 짧고 삐뚤어진 금 (완전한 원 대신 군데군데)
  for (let i = 0; i < tips.length; i++){
    if (Math.random() < 0.45) continue;
    const [x1, y1] = tips[i];
    const [x2, y2] = tips[(i + 1) % tips.length];
    const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * size * 0.12;
    const my = (y1 + y2) / 2 + (Math.random() - 0.5) * size * 0.12;
    paths += crackStroke(`M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${mx.toFixed(1)} ${my.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function addCrackMark(x, y){
  const layer = document.getElementById("crack-layer");
  if (!layer) return;
  const size = 140 + Math.random() * 100;
  const mark = document.createElement("div");
  mark.className = "crack-mark";
  mark.style.left = (x - size / 2) + "px";
  mark.style.top = (y - size / 2) + "px";
  mark.innerHTML = crackMarkSvg(size);
  layer.appendChild(mark);
}

function triggerShatter(){
  if (crackBusy) return;
  crackBusy = true;
  const bsod = document.getElementById("bsod-overlay");
  if (bsod) bsod.classList.add("show");
  // 자동으로 사라지지 않음 — 화면을 한 번 더 클릭하거나 키를 눌러야 꺼짐
}

function setupCrackEasterEgg(){
  const desktop = document.querySelector(".desktop");
  if (!desktop) return;
  desktop.addEventListener("dblclick", (e) => {
    if (crackBusy) return;
    if (e.target.closest(".window, .dicon, .taskbar, .err-toast, .boot-screen, .bsod-overlay")) return;
    crackCount++;
    addCrackMark(e.clientX, e.clientY);
    if (crackCount >= CRACK_LIMIT) triggerShatter();
  });
  const bsod = document.getElementById("bsod-overlay");
  if (bsod){
    bsod.addEventListener("click", () => { bsod.classList.remove("show"); crackCount = 0; crackBusy = false; const l = document.getElementById("crack-layer"); if (l) l.innerHTML = ""; });
    document.addEventListener("keydown", () => { if (bsod.classList.contains("show")){ bsod.classList.remove("show"); crackCount = 0; crackBusy = false; const l = document.getElementById("crack-layer"); if (l) l.innerHTML = ""; } });
  }
}

/* ---------------- 인터넷 창: 가끔(약 20%) 오프라인 공룡 화면 ---------------- */
let inetHomeHTML = null; // 정상 홈페이지 원본 마크업 (최초 로드시 캐시)

function buildDinoHTML(){
  return `
    <div class="inet-dino-page">
      <img class="dino-scene" src="dino.png" alt="offline dino" draggable="false"/>
      <div class="inet-dino-title">You are offline</div>
      <div class="inet-dino-try">
        <p>Try:</p>
        <ul>
          <li>Don't panic</li>
          <li>Look around</li>
          <li>Interact with reality</li>
        </ul>
      </div>
    </div>`;
}

function renderInetHome(){
  const page = document.querySelector("#win-inet .inet-page");
  const addr = document.querySelector("#win-inet .inet-addr");
  if (!page) return;
  if (inetHomeHTML === null) inetHomeHTML = page.innerHTML; // 최초 1회만 원본 캐시
  const showDino = Math.random() < 0.2; // 약 20% 확률
  page.innerHTML = showDino ? buildDinoHTML() : inetHomeHTML;
  if (addr) addr.textContent = showDino ? "http://www.404duck.co.kr/error" : "http://www.404duck.co.kr/";
}

/* ---------------- 바탕화면 우클릭 메뉴: 아이콘 정렬 ---------------- */
function arrangeIcons(){
  document.querySelectorAll(".dicon").forEach(el => {
    el.style.left = "";
    el.style.top = "";
    try {
      localStorage.removeItem("404-icon-pos:" + (el.id || el.textContent));
    } catch(e){}
  });
}

function setupDesktopContextMenu(){
  const desktop = document.querySelector(".desktop");
  if (!desktop) return;

  const menu = document.createElement("div");
  menu.className = "ctx-menu hidden";
  menu.innerHTML =
    '<div class="ctx-item" id="ctx-arrange">아이콘 정렬(A)</div>' +
    '<div class="ctx-sep"></div>' +
    '<div class="ctx-item" id="ctx-refresh">새로고침(R)</div>';
  document.body.appendChild(menu);

  function hideMenu(){ menu.classList.add("hidden"); }
  function showMenuAt(x, y){
    menu.classList.remove("hidden");
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 4) + "px";
    menu.style.top = Math.min(y, window.innerHeight - h - 4) + "px";
  }

  desktop.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".window, .dicon, .taskbar, .err-toast, .boot-screen, .bsod-overlay")) return;
    e.preventDefault();
    showMenuAt(e.clientX, e.clientY);
  });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) hideMenu(); });
  document.addEventListener("contextmenu", (e) => { if (!e.target.closest(".desktop")) hideMenu(); });
  window.addEventListener("scroll", hideMenu, true);

  menu.querySelector("#ctx-arrange").addEventListener("click", () => { arrangeIcons(); hideMenu(); });
  menu.querySelector("#ctx-refresh").addEventListener("click", hideMenu);
}

(function init(){
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  runBootSequence();
  applyErrorToastText();
  setupDragAndResize();
  renderCalendar();
  loadSchedule();
  loadTodo();
  loadGames();
  setupMinesweeper();
  setupCrackEasterEgg();
  setupDesktopContextMenu();
})();
