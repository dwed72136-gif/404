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

/* ---------------- window switching ---------------- */
function showWindow(id){
  document.getElementById("win-schedule").classList.toggle("hidden", id !== "win-schedule");
  document.getElementById("win-archive").classList.toggle("hidden", id !== "win-archive");
  const taskitem = document.getElementById("taskitem");
  if (taskitem){
    taskitem.textContent = id === "win-archive" ? "game_archive.exe" : "404_scheduler.exe";
  }
}
document.getElementById("open-schedule").onclick = () => { if (justDragged) return; showWindow("win-schedule"); };
document.getElementById("open-archive").onclick = () => { if (justDragged) return; showWindow("win-archive"); };
document.getElementById("goto-archive").onclick = () => showWindow("win-archive");
document.getElementById("goto-schedule").onclick = () => showWindow("win-schedule");
document.querySelectorAll("[data-close]").forEach(btn=>{
  btn.onclick = () => btn.closest(".window").classList.add("hidden");
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
  setTimeout(() => { justDragged = false; }, 0);
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
  ["open-schedule","open-archive","icon-chzzk","icon-cafe","icon-x","icon-youtube"].forEach(id=>{
    makeIconDraggable(document.getElementById(id));
  });
  // 링크 아이콘은 드래그 직후엔 새 탭 이동을 막음
  document.querySelectorAll("a.dicon").forEach(a=>{
    a.addEventListener("click", e => { if (justDragged) e.preventDefault(); });
  });
  makeWindowInteractive(document.getElementById("win-schedule"));
  makeWindowInteractive(document.getElementById("win-archive"));
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
})();
