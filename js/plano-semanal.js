import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";

/* ===== Helpers ===== */
const fmt = (dStr) => {
  if (!dStr) return "—";
  const d = new Date(dStr);
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return `${dd}.${mm}.`;
};
const iniciais = (nome="") =>
  nome.trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||"").join("") || "??";

const fun2cls = (func) => {
  if(!func) return "";
  const key = func.toUpperCase().replace(/\W+/g,"_");
  return key === "3D" ? "_3D" : key; // garante classe CSS válida
};

let currentLang = localStorage.getItem("appLang") || "en";

function makeChip({nome, funcao, badge, estado}) {
  const chip = document.createElement("div");
  chip.className = `chip ${fun2cls(funcao||"")}`;
  if (estado === "recusado") chip.classList.add("is-out");

  const sIni = document.createElement("span");
  sIni.className = "iniciais";
  sIni.textContent = iniciais(nome);

  const sFn = document.createElement("span");
  sFn.className = "func";
  sFn.textContent = (funcao||"").toUpperCase();

  chip.appendChild(sIni);
  chip.appendChild(sFn);

  if (badge) {
    chip.classList.add("badge");
    chip.dataset.badge = badge;
  }
  return chip;
}

function isoWeekId(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-S${String(weekNo).padStart(2,'0')}`;
}

/* ===== Render ===== */
async function renderSemanaBoard(semanaId) {
  const tbody = document.getElementById("tbodySemana");
  tbody.innerHTML = "";

  document.getElementById("cwLabel").textContent = semanaId?.toUpperCase() || (t(currentLang, "weekly.cw") || "CW --");

  // eventos: eventos/{semanaId}/lista/*
  const eventosQ = query(collection(db, `eventos/${semanaId}/lista`), orderBy("dataInicio","asc"));
  const eventosSnap = await getDocs(eventosQ);

  let firstStart=null, lastEnd=null;

  for (const evDoc of eventosSnap.docs) {
    const ev = evDoc.data();
    firstStart = firstStart || ev.dataInicio;
    lastEnd = ev.dataFim || lastEnd;

    const tr = document.createElement("tr");

    // ícone
    const tdIcon = document.createElement("td");
    tdIcon.textContent = "🗂️";
    tr.appendChild(tdIcon);

    // meta
    const tdMeta = document.createElement("td");
    tdMeta.className = "meta";
    tdMeta.innerHTML = `
      <div class="title">${ev.nome || (t(currentLang, "weekly.noTitle") || "Sem título")}</div>
      ${ev.notaInterna ? `<div class="sub">[${t(currentLang, "weekly.internalOnly") || "Only internally"}] ${ev.notaInterna}</div>` : ""}
      <div class="sub">${ev.local || ""}${ev.categoria ? " — " + ev.categoria : ""}</div>
    `;
    tr.appendChild(tdMeta);

    // logo
    const tdLogo = document.createElement("td");
    tdLogo.className = "logo";
    if (ev.urlLogo) {
      tdLogo.innerHTML = `<img src="${ev.urlLogo}" alt="logo" style="max-height:38px; max-width:80px;">`;
    } else {
      tdLogo.innerHTML = `<div class="pill">${t(currentLang, "weekly.logoText") || "LOGO"}</div>`;
    }
    tr.appendChild(tdLogo);

    // datas
    const tdStart = document.createElement("td");
    tdStart.className = "dates";
    tdStart.textContent = fmt(ev.dataInicio);
    const tdEnd = document.createElement("td");
    tdEnd.className = "dates";
    tdEnd.textContent = fmt(ev.dataFim);
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);

    // responsáveis
    const tdResp = document.createElement("td");
    tdResp.className = "roles";
    const leader = ev.projectLeader || ev.lider || "—";
    const dispatcher = ev.dispatcher || "—";
    const pm1 = ev.projectManager1 || ev.pm1 || "—";
    const pm2 = ev.projectManager2 || ev.pm2 || "—";
    const travel = ev.travel || "—";
    tdResp.innerHTML = `
      <div>${t(currentLang, "weekly.projectLeader") || "Project leader"}: <b>${leader}</b></div>
      <div>${t(currentLang, "weekly.dispatcher") || "Dispatcher"}: ${dispatcher}</div>
      <div>${t(currentLang, "weekly.pm1") || "Project manager 1"}: ${pm1}</div>
      <div>${t(currentLang, "weekly.pm2") || "Project manager 2"}: ${pm2}</div>
      <div>${t(currentLang, "weekly.travel") || "Travel"}: ${travel}</div>
    `;
    tr.appendChild(tdResp);

    // equipa (chips)
    const tdTeam = document.createElement("td");
    const grid = document.createElement("div");
    grid.className = "staff-grid";
    tdTeam.appendChild(grid);

    // atribuições: eventos/{semanaId}/lista/{eventoId}/atribuicoes/*
    const atribSnap = await getDocs(collection(db, `eventos/${semanaId}/lista/${evDoc.id}/atribuicoes`));
    atribSnap.forEach(aDoc => {
      const a = aDoc.data();
      const chip = makeChip({
        nome: a.nome || a.userName || a.email || aDoc.id,
        funcao: a.funcao || a.role || a.func || "",
        estado: a.estado, // "aceite" | "pendente" | "recusado"
        badge: a.badge || (a.notNeeded ? (t(currentLang, "weekly.badgeNotNeeded") || "not ne*") : (a.notOn ? (t(currentLang, "weekly.badgeNotOn") || "not on*") : null))
      });
      grid.appendChild(chip);
    });

    tr.appendChild(tdTeam);
    tbody.appendChild(tr);
  }

  // texto do range (no topo)
  const w = document.getElementById("weekRange");
  if (firstStart || lastEnd) {
    const startD = new Date(firstStart || lastEnd);
    const endD   = new Date(lastEnd   || firstStart);
    const locale = (currentLang || "en");
    const monthName = startD.toLocaleString(locale, { month:"long" });
    w.textContent = `${startD.getDate()}. ${monthName}, ${fmt(firstStart)} ${t(currentLang, "weekly.to") || "to"} ${fmt(lastEnd)}`;
  } else {
    w.textContent = "";
  }
}

//* ===== Boot ===== */
window.addEventListener("DOMContentLoaded", async () => {
  const body = document.body;
  let semanaId = body.dataset.semana;
  if (!semanaId) semanaId = isoWeekId(new Date()); // fallback: semana ISO atual
  currentLang = localStorage.getItem("appLang") || "en";
  const select = document.getElementById("langSelect");
  if (select) select.value = currentLang;
  if (select) {
    select.addEventListener("change", async () => {
      currentLang = localStorage.getItem("appLang") || select.value;
      await renderSemanaBoard(semanaId);
    });
  }

  // tenta renderizar já
  await renderSemanaBoard(semanaId);

  // e também após auth (se o teu Firestore precisar de sessão)
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentLang = await initUserLanguage(user.uid);
      bindLanguageSelector(document.getElementById("langSelect"), user.uid, currentLang);
    }
    await renderSemanaBoard(semanaId);
  });
});

export { renderSemanaBoard };
