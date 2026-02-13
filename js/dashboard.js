// js/dashboard.js
// — Mantém o teu visual/IDs e acrescenta:
//   • Funções vindas de config/funcoes/lista
//   • Atribuições com transporte: carro (seleção de carro) OU outros (custo, partida, chegada)
//   • ViagensCarro por evento com ODOMETRO (odInicio/odFim) e TotalKms = odFim - odInicio
//   • Totais incluem despesas + custo carros + custos de transportes não-carro
//   • Editar/Apagar evento, despesas, faturação, CSVs

import { app, auth, db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, collection, getDocs, updateDoc, addDoc, deleteDoc,
  serverTimestamp, collectionGroup, Timestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { t } from "./i18n.js";
import { bindLanguageSelector, initUserLanguage, setUserLanguage } from "./i18n.js";

/* -------------------- Estado -------------------- */
let funcoesSelecionadas = [];
let utilizadoresDisponiveis = [];
let produtosConfig = { despesas: [], servicos: [], ativos: [], funcoes: [] };
let editing = { active: false, semanaId: null, eventoId: null };
let ctxDetalhes = { semanaId: null, eventoId: null, evento: null };
let ctxFat = { semanaId: null, eventoId: null };
let currentUserRole = "user";
let currentUserUid = null;
let currentUserName = "";
let currentUserEmail = "";
const functions = getFunctions(app, "europe-west1");
const callAssignmentInvite = httpsCallable(functions, "sendAssignmentInvite");
const callNotifyStatus = httpsCallable(functions, "notifyAssignmentStatus");
const callWeekInvite = httpsCallable(functions, "sendWeekInvite");
let weekInviteCache = new Map();

/* -------------------- Helpers -------------------- */
function getSemanaId(dataISO) {
  const d = new Date(dataISO);
  const ano = d.getFullYear();
  const semana = getWeekNumber(d);
  return `${ano}-S${String(semana).padStart(2, "0")}`;
}
function getWeekNumber(d) {
  const firstDay = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - firstDay) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + firstDay.getDay() + 1) / 7);
}
function parseISODateToComparable(str) {
  if (!str) return Number.POSITIVE_INFINITY;
  const [y,m,d] = String(str).split("-").map(n=>parseInt(n,10));
  if (!y || !m || !d) return Number.POSITIVE_INFINITY;
  return new Date(y, m-1, d).getTime();
}
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const setVal = (el, v) => { if (el) el.value = v; };
const getVal = (el) => (el && typeof el.value === "string") ? el.value.trim() : "";
const toMoney = (n) => (Number(n||0)).toFixed(2);
const getLang = () => localStorage.getItem("appLang") || "en";
const tr = (k, d) => t(getLang(), k) || d;

const maxSigla = (s) => String(s || "").trim().toUpperCase().slice(0, 3) || "---";
const computeSigla = (u = {}) => {
  if (u.sigla) return maxSigla(u.sigla);
  const first = (u.firstName || "").trim();
  const last = (u.lastName || "").trim();
  if (first && last) return maxSigla(first[0] + last[0]);
  if (u.nome) {
    const parts = String(u.nome).trim().split(/\s+/);
    if (parts.length >= 2) return maxSigla(parts[0][0] + parts[parts.length - 1][0]);
    if (parts[0]) return maxSigla(parts[0].slice(0, 2));
  }
  if (u.email) return maxSigla(u.email[0]);
  return "---";
};

const formatDateBR = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const escapeHtml = (v) =>
  String(v || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const weekNumberOnly = (semanaId) => {
  const m = String(semanaId || "").match(/S(\d+)/);
  return m ? m[1] : semanaId;
};

/* -------------------- Boot -------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  let role = "user";
  let userData = null;
  let userDocExists = null;
  try {
    const uSnap = await getDoc(doc(db, "users", user.uid));
    userDocExists = uSnap.exists();
  if (userDocExists) {
      userData = uSnap.data() || {};
      role = userData.role || "user";
    }
  } catch (e) {
    console.warn("Falha a ler role; a continuar como 'user'. Motivo:", e);
  }
  localStorage.setItem("userRole", role);
  currentUserRole = role;
  currentUserUid = user.uid;
  currentUserEmail = user.email || "";
  currentUserName = [userData?.firstName, userData?.lastName].filter(Boolean).join(" ").trim() || userData?.nome || "";

  const lang = await initUserLanguage(user.uid, userData, userDocExists);
  bindLanguageSelector(document.getElementById("langSelect"), user.uid, lang);

  bindMyDetails(user.uid, userData || {});

  const planningAdminActions = document.getElementById("planningAdminActions");
  const adminLinks = document.getElementById("adminLinks");
  const isAdmin = role === "admin";
  if (planningAdminActions) planningAdminActions.style.display = isAdmin ? "block" : "none";
  if (adminLinks) adminLinks.style.display = isAdmin ? "block" : "none";

  const adminOnlyCost = document.getElementById("adminOnlyCost");
  if (adminOnlyCost) adminOnlyCost.style.display = isAdmin ? "block" : "none";
  const mpApagar = document.getElementById("mpApagar");
  if (mpApagar) mpApagar.style.display = isAdmin ? "" : "none";
  const mpEnviarConvite = document.getElementById("mpEnviarConvite");
  if (mpEnviarConvite) mpEnviarConvite.style.display = isAdmin ? "" : "none";
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) btnLogout.onclick = async () => {
    await signOut(auth);
    window.location.href = "index.html";
  };
  const pDailyRate = document.getElementById("pDailyRate");
  if (isAdmin && pDailyRate && userData && userData.dailyRate !== undefined && userData.dailyRate !== null) {
    pDailyRate.value = userData.dailyRate;
  }
  const saveDailyRateBtn = document.getElementById("saveDailyRateBtn");
  if (isAdmin && saveDailyRateBtn && pDailyRate) {
    saveDailyRateBtn.onclick = async () => {
      const v = parseFloat(pDailyRate.value || "0");
      try {
        await setDoc(doc(db, "users", user.uid), { dailyRate: isNaN(v) ? 0 : v }, { merge: true });
        alert(t(localStorage.getItem("appLang") || "en", "profile.costSaved") || "Custo guardado.");
      } catch (e) {
        alert((t(localStorage.getItem("appLang") || "en", "profile.costSaveError") || "Erro ao guardar custo") + ": " + (e?.message || e));
      }
    };
  }

  await carregarConfigProdutos();
  bindModalCriarEvento(isAdmin);
  bindModaisDetalhes();
  bindModalFaturacao();
  await loadTeamList();
  await carregarTodosEventosCronologico();
  document.addEventListener("click", onGlobalClicks);
});

/* -------------------- Config -------------------- */
async function carregarConfigProdutos() {
  try {
    const [sd, ss, sa, sf] = await Promise.all([
      getDocs(collection(db, "config/despesas/lista")),
      getDocs(collection(db, "config/servicos/lista")),
      getDocs(collection(db, "config/ativos/lista")),
      getDocs(collection(db, "config/funcoes/lista")),
    ]);
    produtosConfig.despesas = []; sd.forEach(d => produtosConfig.despesas.push({ id: d.id, ...d.data() }));
    produtosConfig.servicos = []; ss.forEach(d => produtosConfig.servicos.push({ id: d.id, ...d.data() }));
    produtosConfig.ativos   = []; sa.forEach(d => produtosConfig.ativos.push({ id: d.id, ...d.data() }));
    produtosConfig.funcoes  = []; sf.forEach(d => produtosConfig.funcoes.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("Falha ao carregar configuração:", e);
    produtosConfig = { despesas: [], servicos: [], ativos: [], funcoes: [] };
  }
}

/* -------------------- Criar/Editar Evento -------------------- */
function bindModalCriarEvento(isAdmin) {
  const modal = $("#modalCriarEvento");
  const inputNome = $("#eventoNome");
  const inputInicio = $("#eventoInicio");
  const inputFim = $("#eventoFim");
  const inputLocal = $("#eventoLocal");
  const inputResp = $("#eventoResponsavel");
  const inputObs = $("#eventoObs");
  const inputVisivel = $("#eventoVisivel");
  const ulFuncoes = $("#funcoesLista");
  const selectFuncao = $("#funcaoSelect");
  const btnAddFuncao = $("#adicionarFuncaoBtn");
  const btnSalvar = $("#salvarEventoBtn");

  document.addEventListener("click", async (e) => {
    const trg = e.target.closest("#abrirModalBtn, #openCreateEventBtn, #criarEventoBtn, [data-action='open-criar-evento'], [data-open='modalCriarEvento'], button[data-editar-evento]");
    if (!trg) return;
    if (!modal) { alert(tr("alert.modalMissing", "Modal #modalCriarEvento não encontrado no HTML.")); return; }

    const editarBtn = trg.matches("button[data-editar-evento]") ? trg : null;
    editing.active = !!editarBtn; editing.semanaId = null; editing.eventoId = null;

    // Recarrega configuração no momento de abrir para evitar lista de funções em cache.
    await carregarConfigProdutos();
    funcoesSelecionadas = [];
    if (ulFuncoes) ulFuncoes.innerHTML = "";
    if (selectFuncao) populateFuncoesSelect(selectFuncao, funcoesSelecionadas);
    setVal(inputNome, ""); setVal(inputInicio, ""); setVal(inputFim, "");
    setVal(inputLocal, ""); setVal(inputResp, ""); setVal(inputObs, "");
    if (inputVisivel) inputVisivel.checked = false;

    if (editarBtn) {
      const semanaId = editarBtn.getAttribute("data-semana");
      const eventoId = editarBtn.getAttribute("data-id");
      editing.semanaId = semanaId; editing.eventoId = eventoId;
      try {
        const snap = await getDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}`));
        if (snap.exists()) {
          const ev = snap.data() || {};
          setVal(inputNome, ev.nome || "");
          setVal(inputInicio, ev.dataInicio || "");
          setVal(inputFim, ev.dataFim || "");
          setVal(inputLocal, ev.local || "");
          setVal(inputResp, ev.responsavel || "");
          setVal(inputObs, ev.observacoes || "");
          if (inputVisivel) inputVisivel.checked = (ev.visibleToUsers !== false);
          funcoesSelecionadas = Array.isArray(ev.funcoesDisponiveis) ? ev.funcoesDisponiveis.slice() : [];
          renderFuncoesLista(ulFuncoes, funcoesSelecionadas);
        }
      } catch (e2) { console.warn("Falha a carregar evento para editar:", e2); }
    } else {
      if (ulFuncoes) ulFuncoes.innerHTML = "";
    }

    modal.style.display = "block";
  });

  if (btnAddFuncao && selectFuncao && ulFuncoes) {
    btnAddFuncao.onclick = () => {
      const f = getVal(selectFuncao);
      if (!f) return;
      if (!funcoesSelecionadas.includes(f)) funcoesSelecionadas.push(f);
      renderFuncoesLista(ulFuncoes, funcoesSelecionadas);
      selectFuncao.value = "";
    };
  }

  if (ulFuncoes) {
    ulFuncoes.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-remove-funcao]");
      if (!btn) return;
      const f = btn.getAttribute("data-remove-funcao");
      funcoesSelecionadas = funcoesSelecionadas.filter(x => x !== f);
      renderFuncoesLista(ulFuncoes, funcoesSelecionadas);
    });
  }

  if (btnSalvar) {
    btnSalvar.onclick = async () => {
      const nome = getVal(inputNome);
      const inicio = getVal(inputInicio);
      const fim = getVal(inputFim);
      const local = getVal(inputLocal);
      const responsavel = getVal(inputResp);
      const obs = getVal(inputObs);
      const visibleToUsers = !!inputVisivel?.checked;
      if (!nome || !inicio) { alert(tr("alert.fillNameStart", "Preenche pelo menos Nome e Data de Início.")); return; }
      if (localStorage.getItem("userRole") !== "admin") { alert(tr("alert.adminOnly", "Apenas administradores podem criar/editar eventos.")); return; }

      const semanaId = getSemanaId(inicio);
      const evento = {
        nome, dataInicio: inicio, dataInicioTS: Timestamp.fromDate(new Date(inicio)),
        dataFim: fim || null, dataFimTS: fim ? Timestamp.fromDate(new Date(fim)) : null,
        local, responsavel, observacoes: obs,
        funcoesDisponiveis: Array.isArray(funcoesSelecionadas) ? funcoesSelecionadas.slice() : [],
        visibleToUsers
      };

      try {
        if (editing.active && editing.eventoId) {
          if (semanaId === editing.semanaId) {
            await updateDoc(doc(db, `eventos/${semanaId}/lista/${editing.eventoId}`), evento);
          } else {
            const refNew = await addDoc(collection(db, `eventos/${semanaId}/lista`), evento);
            await deleteDoc(doc(db, `eventos/${editing.semanaId}/lista/${editing.eventoId}`));
            editing.eventoId = refNew.id;
          }
          await setDoc(doc(db, "eventos", semanaId), { updatedAt: serverTimestamp() }, { merge: true });
          alert(tr("event.updatedOk", "✅ Evento atualizado com sucesso!"));
        } else {
          const ref = await addDoc(collection(db, `eventos/${semanaId}/lista`), evento);
          await setDoc(doc(db, "eventos", semanaId), { updatedAt: serverTimestamp() }, { merge: true });
          editing.eventoId = ref.id;
          alert(tr("event.createdOk", "✅ Evento criado com sucesso!"));
        }
        if (modal) modal.style.display = "none";
        await carregarTodosEventosCronologico();
      } catch (err) { console.error(err); alert(tr("event.saveError", "❌ Erro ao guardar evento: ") + err.message); }
    };
  }
}

function populateFuncoesSelect(selectEl, selected = []) {
  if (!selectEl) return;
  const current = new Set(selected || []);
  const opts = [];

  if (Array.isArray(produtosConfig.funcoes) && produtosConfig.funcoes.length) {
    produtosConfig.funcoes.forEach(s => {
      const nomeFunc = s?.nome || s?.id;
      if (nomeFunc) opts.push(nomeFunc);
    });
  }

  const unique = Array.from(new Set(opts)).sort((a,b)=> a.localeCompare(b));
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = t(localStorage.getItem("appLang") || "en", "event.selectRole") || "Selecionar função...";
  selectEl.appendChild(opt0);
  unique.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });

  // Se havia funções já selecionadas que não existam no config, mantém-nos na lista
  current.forEach(name => {
    if (unique.includes(name)) return;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${t(localStorage.getItem("appLang") || "en", "event.customRole") || "custom"})`;
    selectEl.appendChild(opt);
  });
}

function renderFuncoesLista(ulFuncoes, funcoesSelecionadas) {
  if (!ulFuncoes) return;
  ulFuncoes.innerHTML = "";
  funcoesSelecionadas.forEach(f => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = f;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.setAttribute("data-remove-funcao", f);
    btn.style.marginLeft = "8px";
    btn.textContent = (t(localStorage.getItem("appLang") || "en", "common.remove") || "Remover");
    li.appendChild(span);
    li.appendChild(btn);
    ulFuncoes.appendChild(li);
  });
}

let ctxPessoa = { semanaId: null, eventoId: null, uid: null, role: null, email: null, name: null, eventName: null, eventStart: null, eventEnd: null };
let teamUsersCache = [];

function buildVCard(u) {
  const first = u.firstName || "";
  const last = u.lastName || "";
  const full = `${first} ${last}`.trim() || u.nome || "";
  const email = u.email || "";
  const phone = u.phone || u.mobile || u.telefone || "";
  const street = u.street || "";
  const city = u.city || "";
  const zip = u.zip || "";
  const country = u.country || "";
  const adr = [street, city, zip, country].filter(Boolean).join(";");
  const bday = u.birthDate || u.dataNascimento || "";
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${last};${first};;;`,
    `FN:${full}`,
    email ? `EMAIL:${email}` : "",
    phone ? `TEL:${phone}` : "",
    adr ? `ADR:;;${adr}` : "",
    bday ? `BDAY:${bday}` : "",
    "END:VCARD",
  ].filter(Boolean).join("\n");
}

function renderTeamTable(list) {
  const tb = document.getElementById("teamTableBody");
  if (!tb) return;
  tb.innerHTML = "";
  list.forEach((u, idx) => {
    const tr = document.createElement("tr");
    const first = u.firstName || (u.nome ? String(u.nome).split(/\s+/)[0] : "") || "-";
    const last = u.lastName || (u.nome ? String(u.nome).split(/\s+/).slice(1).join(" ") : "") || "-";
    const initials = computeSigla(u);
    const address = [u.street, u.zip, u.city, u.country].filter(Boolean).join(" ") || u.morada || "-";
    const phone = u.phone || u.mobile || u.telefone || "-";
    const email = u.email || "-";
    const birth = u.birthDate || u.dataNascimento || "-";
    const avatar = u.profilePic
      ? `<img src="${u.profilePic}" alt="">`
      : `<span>${(initials && initials !== "-" ? initials : (first?.[0] || "") + (last?.[0] || "")).substring(0,3)}</span>`;
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><div class="team-avatar">${avatar}</div></td>
      <td>${first || "-"}</td>
      <td>${last || "-"}</td>
      <td>${initials}</td>
      <td>${address}</td>
      <td>${phone}</td>
      <td>${email}</td>
      <td>${birth}</td>
      <td><button class="team-vcard" data-vcard="${u.id}">⬇︎</button></td>
    `;
    tb.appendChild(tr);
  });
}

function applyTeamFilters() {
  const fFirst = (document.getElementById("teamFilterFirst")?.value || "").toLowerCase();
  const fLast = (document.getElementById("teamFilterLast")?.value || "").toLowerCase();
  const fInit = (document.getElementById("teamFilterInitials")?.value || "").toLowerCase();
  const fAddr = (document.getElementById("teamFilterAddress")?.value || "").toLowerCase();
  const fPhone = (document.getElementById("teamFilterPhone")?.value || "").toLowerCase();
  const fEmail = (document.getElementById("teamFilterEmail")?.value || "").toLowerCase();
  const fBirth = (document.getElementById("teamFilterBirth")?.value || "").toLowerCase();

  const filtered = teamUsersCache.filter((u) => {
    const fallbackFirst = u.nome ? String(u.nome).split(/\s+/)[0] : "";
    const fallbackLast = u.nome ? String(u.nome).split(/\s+/).slice(1).join(" ") : "";
    const first = (u.firstName || fallbackFirst || "").toLowerCase();
    const last = (u.lastName || fallbackLast || "").toLowerCase();
    const initials = computeSigla(u).toLowerCase();
    const address = ([u.street, u.zip, u.city, u.country].filter(Boolean).join(" ") || u.morada || "").toLowerCase();
    const phone = (u.phone || u.mobile || u.telefone || "").toLowerCase();
    const email = (u.email || "").toLowerCase();
    const birth = (u.birthDate || u.dataNascimento || "").toLowerCase();

    if (fFirst && !first.includes(fFirst)) return false;
    if (fLast && !last.includes(fLast)) return false;
    if (fInit && !initials.includes(fInit)) return false;
    if (fAddr && !address.includes(fAddr)) return false;
    if (fPhone && !phone.includes(fPhone)) return false;
    if (fEmail && !email.includes(fEmail)) return false;
    if (fBirth && !birth.includes(fBirth)) return false;
    return true;
  });
  renderTeamTable(filtered);
}

async function loadTeamList() {
  const tb = document.getElementById("teamTableBody");
  if (!tb) return;
  const lang = localStorage.getItem("appLang") || "en";
  tb.innerHTML = `<tr><td colspan="10">${t(lang, "common.loading") || "Loading..."}</td></tr>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    const rows = [];
    snap.forEach((d) => {
      rows.push({ id: d.id, ...d.data() });
    });
    rows.sort((a, b) => {
      const an = (a.lastName || a.nome || a.email || a.id || "").toString();
      const bn = (b.lastName || b.nome || b.email || b.id || "").toString();
      return an.localeCompare(bn);
    });
    teamUsersCache = rows;
    renderTeamTable(rows);
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="10">${t(lang, "common.loadError") || "Error loading."}</td></tr>`;
    console.error(e);
  }

  ["teamFilterFirst","teamFilterLast","teamFilterInitials","teamFilterAddress","teamFilterPhone","teamFilterEmail","teamFilterBirth"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.oninput = applyTeamFilters;
    });

  const body = document.getElementById("teamTableBody");
  if (body) {
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-vcard]");
      if (!btn) return;
      const uid = btn.getAttribute("data-vcard");
      const u = teamUsersCache.find((x) => x.id === uid);
      if (!u) return;
      const vcard = buildVCard(u);
      const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const name = (u.firstName || u.nome || "user").replace(/\s+/g, "_");
      a.download = `${name}.vcf`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}

function abrirModalPessoa(cardEl) {
  const modal = document.getElementById("modalPessoa");
  if (!modal || !cardEl) return;
  const nome = cardEl.dataset.nome || "-";
  const email = cardEl.dataset.email || "-";
  const tel = cardEl.dataset.tel || "-";
  const funcao = cardEl.dataset.funcao || "-";
  const custo = cardEl.dataset.custo !== "" ? cardEl.dataset.custo : "-";

  ctxPessoa = {
    semanaId: cardEl.dataset.semana || null,
    eventoId: cardEl.dataset.evento || null,
    uid: cardEl.dataset.uid || null,
    role: cardEl.dataset.funcao || null,
    email: cardEl.dataset.email || null,
    name: cardEl.dataset.nome || null,
    eventName: cardEl.dataset.eventName || null,
    eventStart: cardEl.dataset.eventStart || null,
    eventEnd: cardEl.dataset.eventEnd || null
  };

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText("mpNome", nome);
  setText("mpEmail", email);
  setText("mpTel", tel);
  setText("mpFuncao", funcao);
  setText("mpCusto", custo !== "-" ? `€ ${toMoney(custo)}` : "-");

  modal.style.display = "block";
}

function bindMyDetails(uid, userData) {
  const getEl = (id) => document.getElementById(id);
  const setVal = (id, v) => { const el = getEl(id); if (el) el.value = v ?? ""; };
  const getVal = (id) => {
    const el = getEl(id);
    return el && typeof el.value === "string" ? el.value.trim() : "";
  };
  const setCheck = (id, v) => { const el = getEl(id); if (el) el.checked = !!v; };
  const getCheck = (id) => !!getEl(id)?.checked;
  const status = document.getElementById("saveMyDetailsStatus");

  // General
  const fallbackFullName = userData.nome || "";
  let fallbackFirst = "";
  let fallbackLast = "";
  if (fallbackFullName && !userData.firstName && !userData.lastName) {
    const parts = String(fallbackFullName).trim().split(/\s+/);
    fallbackFirst = parts.shift() || "";
    fallbackLast = parts.join(" ");
  }
  setVal("pSalutation", userData.salutation);
  setVal("pFirstName", userData.firstName || fallbackFirst);
  setVal("pLastName", userData.lastName || fallbackLast);
  setVal("pProfilePic", userData.profilePic);
  setVal("pEmail", userData.email);
  setVal("pStreet", userData.street || userData.morada);
  setVal("pZip", userData.zip);
  setVal("pCity", userData.city);
  setVal("pCountry", userData.country);
  setVal("pPhone", userData.phone || userData.telefone);
  setVal("pMobile", userData.mobile);
  setVal("pFax", userData.fax);
  setVal("pBirthDate", userData.birthDate || userData.dataNascimento);
  setVal("pEntryDate", userData.entryDate);

  // Settings
  const langSelect = getEl("pSystemLang");
  if (langSelect) {
    const lang = userData.language || localStorage.getItem("appLang") || "en";
    langSelect.value = lang;
    langSelect.onchange = async () => {
      const next = langSelect.value || "en";
      await setUserLanguage(uid, next);
      const sidebarLang = document.getElementById("langSelect");
      if (sidebarLang) sidebarLang.value = next;
    };
  }
  setVal("pSystemColor", userData.systemColor);
  const quick = userData.quickSidebar || {};
  setCheck("pQuickHippodata", quick.hippodata);
  setCheck("pQuickEvents", quick.events);
  setCheck("pQuickPerformance", quick.performance);
  setCheck("pQuickMaterials", quick.materials);
  setCheck("pQuickStaff", quick.staff);
  setCheck("pQuickTeam", quick.team);

  // Longines articles
  const longines = userData.longines || {};
  setVal("pShirtSize", longines.shirtSize);
  setVal("pCorrectFit", longines.correctFit);
  setVal("pSleeveLength", longines.sleeveLength);
  setVal("pPoloSize", longines.poloSize);
  setVal("pShirtsNeed", longines.shirtsNeed);
  setVal("pPoloExists", longines.poloExists);
  setCheck("pWatchAvailable", longines.watchAvailable);
  setVal("pWatchModel", longines.watchModel);

  // Driving licence
  const dl = userData.drivingLicense || {};
  const dlc = dl.categories || {};
  setVal("pDlNumber", dl.number);
  setCheck("pDlB", dlc.B?.enabled);
  setVal("pDlBValid", dlc.B?.validUntil);
  setVal("pDlBRestr", dlc.B?.restrictions);
  setCheck("pDlBE", dlc.BE?.enabled);
  setVal("pDlBEValid", dlc.BE?.validUntil);
  setVal("pDlBERestr", dlc.BE?.restrictions);
  setCheck("pDlC1", dlc.C1?.enabled);
  setVal("pDlC1Valid", dlc.C1?.validUntil);
  setVal("pDlC1Restr", dlc.C1?.restrictions);
  setCheck("pDlC1E", dlc.C1E?.enabled);
  setVal("pDlC1EValid", dlc.C1E?.validUntil);
  setVal("pDlC1ERestr", dlc.C1E?.restrictions);
  setCheck("pDlC", dlc.C?.enabled);
  setVal("pDlCValid", dlc.C?.validUntil);
  setVal("pDlCRestr", dlc.C?.restrictions);
  setCheck("pDlCE", dlc.CE?.enabled);
  setVal("pDlCEValid", dlc.CE?.validUntil);
  setVal("pDlCERestr", dlc.CE?.restrictions);
  setCheck("pDriverCardExists", dl.driverCard?.exists);
  setVal("pDriverCardNumber", dl.driverCard?.number);
  setVal("pDriverCardValid", dl.driverCard?.validUntil);
  setCheck("pFqnAvailable", dl.fqn?.available);
  setVal("pFqnSerial", dl.fqn?.serial);
  setVal("pFqnExpire", dl.fqn?.expire);

  // Passport
  const passport = userData.passport || {};
  setVal("pGlobalEntry", passport.globalEntry);
  const p1 = passport.passport1 || {};
  setVal("pPassNo1", p1.number);
  setVal("pPassLast1", p1.lastName);
  setVal("pPassFirst1", p1.firstName);
  setVal("pPassNat1", p1.nationality);
  setVal("pPassGender1", p1.gender);
  setVal("pPassBirth1", p1.placeBirth);
  setVal("pPassIssue1", p1.placeIssue);
  setVal("pPassIssueDate1", p1.issueDate);
  setVal("pPassValid1", p1.validUntil);
  const p2 = passport.passport2 || {};
  setVal("pPassNo2", p2.number);
  setVal("pPassLast2", p2.lastName);
  setVal("pPassFirst2", p2.firstName);
  setVal("pPassNat2", p2.nationality);
  setVal("pPassGender2", p2.gender);
  setVal("pPassBirth2", p2.placeBirth);
  setVal("pPassIssue2", p2.placeIssue);
  setVal("pPassIssueDate2", p2.issueDate);
  setVal("pPassValid2", p2.validUntil);

  // Travel cards
  const travel = userData.travelCards || {};
  const ff = travel.frequentFlyer || [];
  for (let i = 1; i <= 5; i++) {
    setVal(`pFFCard${i}`, ff[i - 1]?.card);
    setVal(`pFFNumber${i}`, ff[i - 1]?.number);
  }
  const car = travel.carRental || [];
  for (let i = 1; i <= 4; i++) {
    setVal(`pCarCard${i}`, car[i - 1]?.card);
    setVal(`pCarNumber${i}`, car[i - 1]?.number);
  }
  const hotel = travel.hotelBonus || [];
  for (let i = 1; i <= 4; i++) {
    setVal(`pHotelCard${i}`, hotel[i - 1]?.card);
    setVal(`pHotelNumber${i}`, hotel[i - 1]?.number);
  }

  // Flight prefs
  const flight = userData.flightPrefs || {};
  setVal("pPrefSeat", flight.preferredSeat);
  setVal("pPrefMeal", flight.preferredMeal);
  const home = flight.homeAirports || [];
  setVal("pHomeAirport1", home[0]);
  setVal("pHomeAirport2", home[1]);
  setVal("pHomeAirport3", home[2]);
  const alt = flight.altHomeAirports || [];
  setVal("pAltAirport1", alt[0]);
  setVal("pAltAirport2", alt[1]);
  setVal("pAltAirport3", alt[2]);

  // Hyperlinks
  const links = userData.hyperlinks || [];
  setVal("pLink1", links[0]);
  setVal("pLink2", links[1]);
  setVal("pLink3", links[2]);
  setVal("pLink4", links[3]);
  setVal("pLink5", links[4]);

  const saveAll = async () => {
    const payload = {
      salutation: getVal("pSalutation") || null,
      firstName: getVal("pFirstName") || null,
      lastName: getVal("pLastName") || null,
      profilePic: getVal("pProfilePic") || null,
      email: getVal("pEmail") || null,
      street: getVal("pStreet") || null,
      zip: getVal("pZip") || null,
      city: getVal("pCity") || null,
      country: getVal("pCountry") || null,
      phone: getVal("pPhone") || null,
      mobile: getVal("pMobile") || null,
      fax: getVal("pFax") || null,
      birthDate: getVal("pBirthDate") || null,
      entryDate: getVal("pEntryDate") || null,
      systemColor: getVal("pSystemColor") || null,
      quickSidebar: {
        hippodata: getCheck("pQuickHippodata"),
        events: getCheck("pQuickEvents"),
        performance: getCheck("pQuickPerformance"),
        materials: getCheck("pQuickMaterials"),
        staff: getCheck("pQuickStaff"),
        team: getCheck("pQuickTeam"),
      },
      longines: {
        shirtSize: getVal("pShirtSize") || null,
        correctFit: getVal("pCorrectFit") || null,
        sleeveLength: getVal("pSleeveLength") || null,
        poloSize: getVal("pPoloSize") || null,
        shirtsNeed: getVal("pShirtsNeed") || null,
        poloExists: getVal("pPoloExists") || null,
        watchAvailable: getCheck("pWatchAvailable"),
        watchModel: getVal("pWatchModel") || null,
      },
      drivingLicense: {
        number: getVal("pDlNumber") || null,
        categories: {
          B: { enabled: getCheck("pDlB"), validUntil: getVal("pDlBValid") || null, restrictions: getVal("pDlBRestr") || null },
          BE: { enabled: getCheck("pDlBE"), validUntil: getVal("pDlBEValid") || null, restrictions: getVal("pDlBERestr") || null },
          C1: { enabled: getCheck("pDlC1"), validUntil: getVal("pDlC1Valid") || null, restrictions: getVal("pDlC1Restr") || null },
          C1E: { enabled: getCheck("pDlC1E"), validUntil: getVal("pDlC1EValid") || null, restrictions: getVal("pDlC1ERestr") || null },
          C: { enabled: getCheck("pDlC"), validUntil: getVal("pDlCValid") || null, restrictions: getVal("pDlCRestr") || null },
          CE: { enabled: getCheck("pDlCE"), validUntil: getVal("pDlCEValid") || null, restrictions: getVal("pDlCERestr") || null },
        },
        driverCard: {
          exists: getCheck("pDriverCardExists"),
          number: getVal("pDriverCardNumber") || null,
          validUntil: getVal("pDriverCardValid") || null,
        },
        fqn: {
          available: getCheck("pFqnAvailable"),
          serial: getVal("pFqnSerial") || null,
          expire: getVal("pFqnExpire") || null,
        },
      },
      passport: {
        globalEntry: getVal("pGlobalEntry") || null,
        passport1: {
          number: getVal("pPassNo1") || null,
          lastName: getVal("pPassLast1") || null,
          firstName: getVal("pPassFirst1") || null,
          nationality: getVal("pPassNat1") || null,
          gender: getVal("pPassGender1") || null,
          placeBirth: getVal("pPassBirth1") || null,
          placeIssue: getVal("pPassIssue1") || null,
          issueDate: getVal("pPassIssueDate1") || null,
          validUntil: getVal("pPassValid1") || null,
        },
        passport2: {
          number: getVal("pPassNo2") || null,
          lastName: getVal("pPassLast2") || null,
          firstName: getVal("pPassFirst2") || null,
          nationality: getVal("pPassNat2") || null,
          gender: getVal("pPassGender2") || null,
          placeBirth: getVal("pPassBirth2") || null,
          placeIssue: getVal("pPassIssue2") || null,
          issueDate: getVal("pPassIssueDate2") || null,
          validUntil: getVal("pPassValid2") || null,
        },
      },
      travelCards: {
        frequentFlyer: Array.from({ length: 5 }, (_, i) => ({
          card: getVal(`pFFCard${i + 1}`) || null,
          number: getVal(`pFFNumber${i + 1}`) || null,
        })),
        carRental: Array.from({ length: 4 }, (_, i) => ({
          card: getVal(`pCarCard${i + 1}`) || null,
          number: getVal(`pCarNumber${i + 1}`) || null,
        })),
        hotelBonus: Array.from({ length: 4 }, (_, i) => ({
          card: getVal(`pHotelCard${i + 1}`) || null,
          number: getVal(`pHotelNumber${i + 1}`) || null,
        })),
      },
      flightPrefs: {
        preferredSeat: getVal("pPrefSeat") || null,
        preferredMeal: getVal("pPrefMeal") || null,
        homeAirports: [getVal("pHomeAirport1") || null, getVal("pHomeAirport2") || null, getVal("pHomeAirport3") || null],
        altHomeAirports: [getVal("pAltAirport1") || null, getVal("pAltAirport2") || null, getVal("pAltAirport3") || null],
      },
      hyperlinks: [getVal("pLink1") || null, getVal("pLink2") || null, getVal("pLink3") || null, getVal("pLink4") || null, getVal("pLink5") || null],
    };

    try {
      await setDoc(doc(db, "users", uid), payload, { merge: true });
      if (status) status.textContent = t(localStorage.getItem("appLang") || "en", "profile.saved") || "Guardado.";
    } catch (e) {
      if (status) status.textContent = "";
      alert((t(localStorage.getItem("appLang") || "en", "profile.saveError") || "Erro ao guardar") + ": " + (e?.message || e));
    }
  };

  document.querySelectorAll(".md-save").forEach((btn) => {
    btn.onclick = saveAll;
  });
}

/* -------------------- Listagem global -------------------- */
async function carregarTodosEventosCronologico() {
  const container = document.getElementById("eventosContainer");
  if (!container) return;
  container.innerHTML = `<p>${tr("common.loading", "A carregar...")}</p>`;

  try {
    const cg = await getDocs(collectionGroup(db, "lista"));
    const eventos = [];
    cg.forEach((docSnap) => {
      const path = docSnap.ref.path;
      if (!path.startsWith("eventos/")) return;
      const data = docSnap.data() || {};
      const parts = path.split("/");
      const semanaId = parts.length >= 2 ? parts[1] : "(semana?)";
      eventos.push({
        id: docSnap.id, semanaId,
        nome: data.nome || "Sem nome",
        dataInicio: data.dataInicio || "", dataInicioTS: data.dataInicioTS || null,
        dataFim: data.dataFim || "", dataFimTS: data.dataFimTS || null,
        local: data.local || "", responsavel: data.responsavel || "",
        funcoesDisponiveis: Array.isArray(data.funcoesDisponiveis) ? data.funcoesDisponiveis : [],
        visibleToUsers: data.visibleToUsers
      });
    });

    eventos.sort((a,b) => {
      const ta = a.dataInicioTS?.toMillis?.() || parseISODateToComparable(a.dataInicio);
      const tb = b.dataInicioTS?.toMillis?.() || parseISODateToComparable(b.dataInicio);
      return ta - tb;
    });

    if (!eventos.length) { container.innerHTML = `<p>${tr("alert.noEventsFound", "Sem eventos encontrados.")}</p>`; return; }

    const isAdmin = (localStorage.getItem("userRole") || currentUserRole) === "admin";
    const byWeek = new Map();
    eventos.forEach((ev) => {
      if (!byWeek.has(ev.semanaId)) byWeek.set(ev.semanaId, []);
      byWeek.get(ev.semanaId).push(ev);
    });
    const semanaIds = Array.from(byWeek.keys());

    const weekInviteStatus = new Map();
    const weekInviteAdminSummary = new Map();
    if (!isAdmin && currentUserUid) {
      await Promise.all(semanaIds.map(async (sid) => {
        try {
          const snap = await getDoc(doc(db, `eventos/${sid}/convitesSemana/${currentUserUid}`));
          if (snap.exists()) weekInviteStatus.set(sid, snap.data().status || "pendente");
        } catch (e) {}
      }));
    } else if (isAdmin) {
      let usersById = new Map();
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach((d) => usersById.set(d.id, d.data() || {}));
      } catch (e) {
        usersById = new Map();
      }
      await Promise.all(semanaIds.map(async (sid) => {
        try {
          const cSnap = await getDocs(collection(db, `eventos/${sid}/convitesSemana`));
          const summary = {
            total: 0,
            aceite: 0,
            pendente: 0,
            recusado: 0,
            items: []
          };
          cSnap.forEach((d) => {
            const raw = (d.data()?.status || "pendente").toString().toLowerCase();
            const status = raw === "aceite" || raw === "recusado" || raw === "pendente" ? raw : "pendente";
            summary.total += 1;
            summary[status] += 1;
            const u = usersById.get(d.id) || {};
            const displayName =
              [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
              u.nome ||
              u.email ||
              d.id;
            summary.items.push({ uid: d.id, status, name: displayName });
          });
          summary.items.sort((a, b) => a.name.localeCompare(b.name));
          weekInviteAdminSummary.set(sid, summary);
        } catch (e) {
          weekInviteAdminSummary.set(sid, { total: 0, aceite: 0, pendente: 0, recusado: 0, items: [] });
        }
      }));
    }
    weekInviteCache = weekInviteStatus;

    const frag = document.createDocumentFragment();
    for (const semanaId of semanaIds) {
      const weekEvents = byWeek.get(semanaId) || [];
      const weekBlock = document.createElement("div");
      weekBlock.className = "card";

      const weekNum = weekNumberOnly(semanaId);
      const minDate = weekEvents.reduce((m, e) => !m || (e.dataInicio && e.dataInicio < m) ? e.dataInicio : m, "");
      const maxDate = weekEvents.reduce((m, e) => !m || (e.dataFim && e.dataFim > m) ? e.dataFim : m, "");
      const dateRange = minDate ? `${formatDateBR(minDate)}${maxDate ? " - " + formatDateBR(maxDate) : ""}` : "";

      const status = weekInviteStatus.get(semanaId) || "";
      const statusLabel = status ? (t(localStorage.getItem("appLang") || "en", `status.${status}`) || status) : "";
      const adminWeekSummary = weekInviteAdminSummary.get(semanaId);
      const byStatusBadges = (st) => {
        if (!adminWeekSummary || !Array.isArray(adminWeekSummary.items)) return "";
        const names = adminWeekSummary.items.filter((x) => x.status === st).map((x) => x.name);
        if (!names.length) return "";
        const shown = names.slice(0, 10).map((name) => `<span class="badge atr-status-${st}">${escapeHtml(name)}</span>`).join(" ");
        const hiddenCount = names.length - Math.min(names.length, 10);
        const more = hiddenCount > 0 ? ` <span class="muted">+${hiddenCount}</span>` : "";
        return `${shown}${more}`;
      };
      const adminSummaryHtml = isAdmin ? `
        <div class="muted" style="width:100%;">
          ${tr("week.invite", "Convite semana")}: ${adminWeekSummary?.total || 0}
          · ${tr("status.aceite", "aceite")}: ${adminWeekSummary?.aceite || 0}
          · ${tr("status.pendente", "pendente")}: ${adminWeekSummary?.pendente || 0}
          · ${tr("status.rejeitado", "rejeitado")}: ${adminWeekSummary?.recusado || 0}
        </div>
        ${adminWeekSummary?.total ? `
          <div style="width:100%; margin-top:4px;">
            ${adminWeekSummary.aceite ? `<div class="muted" style="margin-top:2px;">${tr("status.aceite", "aceite")}: ${byStatusBadges("aceite")}</div>` : ""}
            ${adminWeekSummary.pendente ? `<div class="muted" style="margin-top:2px;">${tr("status.pendente", "pendente")}: ${byStatusBadges("pendente")}</div>` : ""}
            ${adminWeekSummary.recusado ? `<div class="muted" style="margin-top:2px;">${tr("status.rejeitado", "rejeitado")}: ${byStatusBadges("recusado")}</div>` : ""}
          </div>
        ` : ""}
      ` : "";

      weekBlock.innerHTML = `
        <div class="week-header" style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0;">${t(localStorage.getItem("appLang") || "en", "weekly.week") || "Semana"} ${weekNum}</h3>
            ${dateRange ? `<div class="muted">${dateRange}</div>` : ""}
          </div>
          <div class="week-actions" style="display:flex; gap:6px; flex-wrap:wrap;">
            ${isAdmin ? `<button class="btn" data-send-week-invites data-semana="${semanaId}">${t(localStorage.getItem("appLang") || "en", "week.sendInviteAll") || "Enviar convites semana"}</button>` : ""}
            ${!isAdmin && status ? `<span class="badge atr-status-${status}">${t(localStorage.getItem("appLang") || "en", "week.invite") || "Convite semana"}: ${statusLabel}</span>` : ""}
            ${isAdmin && status ? `<span class="badge atr-status-${status}">${t(localStorage.getItem("appLang") || "en", "week.invite") || "Convite semana"}: ${statusLabel}</span>` : ""}
            ${!isAdmin && status === "pendente" ? `
              <button class="btn" data-week-accept data-semana="${semanaId}">${t(localStorage.getItem("appLang") || "en", "week.accept") || "Aceitar semana"}</button>
              <button class="btn" data-week-reject data-semana="${semanaId}">${t(localStorage.getItem("appLang") || "en", "week.reject") || "Recusar semana"}</button>
            ` : ""}
            ${adminSummaryHtml}
          </div>
        </div>
        <div class="week-events" id="week-${semanaId}"></div>
      `;

      const weekEventsWrap = weekBlock.querySelector(`#week-${semanaId}`);
      weekEvents.forEach((ev) => {
        const isVisible = ev.visibleToUsers !== false;
        if (!isAdmin && !isVisible) return;
        const bloco = document.createElement("div");
        bloco.className = "card";
        const di = ev.dataInicio || ""; const df = ev.dataFim || "";
        const visLabel = isVisible ? "👁 Visível" : "🙈 Oculto";
        bloco.innerHTML = `
          <h3>${ev.nome}</h3>
          <p><strong>Data:</strong> ${di}${df ? " → " + df : ""}</p>
          <p><strong>Semana:</strong> <span class="badge">${ev.semanaId}</span></p>
          <p><strong>Local:</strong> ${ev.local || "-"}</p>
          <p><strong>Project Leader:</strong> ${ev.responsavel || "-"}</p>
          ${isAdmin ? `<p><strong>${visLabel}</strong></p>` : ""}

          <div class="funcoesVisiveis" id="funcoes-${ev.id}" style="margin-top:8px; display:none;"></div>
          <div id="atribs-${ev.id}" style="margin-top:10px;"></div>

          <div class="actions" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            ${isAdmin ? `
              <button data-abrir-atribs data-semana="${ev.semanaId}" data-id="${ev.id}">📥 Atribuir Funções</button>
              <button class="btn" data-detalhes-evento data-semana="${ev.semanaId}" data-id="${ev.id}">💼 Detalhes</button>
              <button class="btn" data-faturacao-evento data-semana="${ev.semanaId}" data-id="${ev.id}">📄 Faturação</button>
              <button class="btn" data-editar-evento data-semana="${ev.semanaId}" data-id="${ev.id}">✏️ Editar</button>
              <button class="btn" data-apagar-evento data-semana="${ev.semanaId}" data-id="${ev.id}">🗑 Apagar</button>
              <button class="btn" data-toggle-visibility data-semana="${ev.semanaId}" data-id="${ev.id}" data-visible="${isVisible ? "1" : "0"}">${isVisible ? "🙈 Ocultar" : "👁 Mostrar"}</button>
            ` : ``}
          </div>
        `;
        weekEventsWrap.appendChild(bloco);
      });

      frag.appendChild(weekBlock);
    }
    container.innerHTML = ""; container.appendChild(frag);

    container.querySelectorAll("[data-abrir-atribs]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const semanaId = btn.getAttribute("data-semana");
        const eventoId = btn.getAttribute("data-id");
        const ev = eventos.find(e => e.id === eventoId && e.semanaId === semanaId);
        if (!ev) return;
        await abrirUIAtribuicoesInline({ ...ev, id: ev.id }, semanaId);
      });
    });

    for (const ev of eventos) {
      const isVisible = ev.visibleToUsers !== false;
      if (!isAdmin && !isVisible) continue;
      await renderFuncoesEVagas({ ...ev, id: ev.id }, ev.semanaId);
    }

  } catch (e) {
    console.error("Erro ao carregar todos os eventos:", e);
    container.innerHTML = `<p>❌ ${tr("alert.loadEventsError", "Erro ao carregar todos os eventos.")}</p>`;
  }
}

/* -------------------- Render funções + atribuições -------------------- */
async function renderFuncoesEVagas(evento, semanaId) {
  const div = document.getElementById(`funcoes-${evento.id}`);
  if (div) { div.innerHTML = ""; div.style.display = "none"; }

  const funcoes = Array.isArray(evento.funcoesDisponiveis) ? evento.funcoesDisponiveis.slice() : [];
  if (!funcoes.length) return;

  const containerElement = document.getElementById(`atribs-${evento.id}`);
  if (!containerElement) return;
  containerElement.innerHTML = "";

  let atribMap = new Map(); // funcao -> { uid, atrib }
  try {
    const snap = await getDocs(collection(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes`));
    snap.forEach(docSnap => {
      const atrib = docSnap.data() || {};
      if (atrib.funcao) atribMap.set(atrib.funcao, { uid: docSnap.id, atrib });
    });
  } catch (e) {
    console.warn("Falha a listar atribuições:", e);
  }

  // carrega users uma vez
  let usersMap = new Map();
  try {
    const us = await getDocs(collection(db, "users"));
    us.forEach(d => usersMap.set(d.id, d.data() || {}));
  } catch (e) {}

  const lang = localStorage.getItem("appLang") || "en";
  const fmtTransport = (tleg) => {
    if (!tleg) return t(lang, "person.noTransport") || "Sem dados";
    const parts = [];
    if (tleg.tipo) parts.push(`${t(lang, "person.transport") || "Transporte"}: ${tleg.tipo}`);
    if (tleg.partida) parts.push(`${t(lang, "event.departure") || "Partida"} ${tleg.partida}`);
    if (tleg.chegada) parts.push(`${t(lang, "event.arrival") || "Chegada"} ${tleg.chegada}`);
    if (tleg.data) parts.push(`${t(lang, "event.travelDate") || "Data"} ${tleg.data}`);
    if (tleg.hora) parts.push(`${t(lang, "event.travelTime") || "Hora"} ${tleg.hora}`);
    if (tleg.tipo && tleg.tipo !== "carro" && tleg.custo) parts.push(`€ ${toMoney(tleg.custo)}`);
    return parts.join(" | ") || (t(lang, "person.noTransport") || "Sem dados");
  };

  for (const f of funcoes) {
    const bloco = document.createElement("div");
    const atribInfo = atribMap.get(f);

    if (!atribInfo) {
      bloco.className = "atr-card atr-card--empty";
      bloco.innerHTML = `
        <div class="atr-card__role">${f}</div>
        <div class="atr-card__sigla">---</div>
        <div class="atr-card__icons"></div>
      `;
      containerElement.appendChild(bloco);
      continue;
    }

    const { uid, atrib } = atribInfo;
    const user = usersMap.get(uid) || {};
    const isAdmin = (localStorage.getItem("userRole") || currentUserRole) === "admin";
    const weekStatus = weekInviteCache.get(semanaId) || "";
    const canSeeAllInWeek = weekStatus === "aceite";
    if (!isAdmin && !canSeeAllInWeek && uid !== currentUserUid) {
      bloco.className = "atr-card atr-card--empty";
      bloco.innerHTML = `
        <div class="atr-card__role">${f}</div>
        <div class="atr-card__sigla">---</div>
        <div class="atr-card__icons"></div>
      `;
      containerElement.appendChild(bloco);
      continue;
    }
    const sigla = computeSigla(user);
    const status = atrib.status || "pendente";
    const transporte = atrib.transporte || {};
    const ida = transporte.ida || transporte;
    const volta = transporte.volta || {};

    bloco.className = `atr-card atr-status-${status}`;
    bloco.dataset.uid = uid;
    bloco.dataset.funcao = atrib.funcao || f;
    const userName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.nome || "";
    bloco.dataset.email = user.email || "";
    bloco.dataset.nome = userName;
    bloco.dataset.tel = user.telefone || user.tel || user.phone || user.mobile || "";
    bloco.dataset.custo = (atrib.custoPessoa ?? "");
    bloco.dataset.semana = semanaId;
    bloco.dataset.evento = evento.id;
    bloco.dataset.eventName = evento.nome || "";
    bloco.dataset.eventStart = evento.dataInicio || "";
    bloco.dataset.eventEnd = evento.dataFim || "";

    const iconForTipo = (tipo) => {
      switch ((tipo || "").toLowerCase()) {
        case "carro": return { icon: "🚗", cls: "atr-icon--car" };
        case "voo":
        case "avião":
        case "aviao": return { icon: "✈️", cls: "atr-icon--plane" };
        case "comboio": return { icon: "🚆", cls: "atr-icon--train" };
        case "outro": return { icon: "✖", cls: "atr-icon--other" };
        default: return { icon: "—", cls: "atr-icon--none" };
      }
    };
    const iIda = iconForTipo(ida.tipo);
    const iVolta = iconForTipo(volta.tipo);
    bloco.innerHTML = `
      <div class="atr-card__role">${f}</div>
      <div class="atr-card__sigla">${sigla}</div>
      <div class="atr-card__icons">
        <span class="atr-icon ${iIda.cls}" title="${fmtTransport(ida)}" data-tt="${fmtTransport(ida)}">${iIda.icon}</span>
        <span class="atr-icon ${iVolta.cls}" title="${fmtTransport(volta)}" data-tt="${fmtTransport(volta)}">${iVolta.icon}</span>
      </div>
    `;

    bloco.addEventListener("click", (e) => {
      // não abre modal quando clica nos ícones
      if (e.target && e.target.classList.contains("atr-icon")) return;
      if (currentUserRole !== "admin" && uid !== currentUserUid) return;
      abrirModalPessoa(bloco);
    });
    bloco.querySelectorAll(".atr-icon").forEach(ic=>{
      ic.addEventListener("click", (e)=>{
        e.stopPropagation();
        alert(ic.getAttribute("data-tt") || "");
      });
    });

    containerElement.appendChild(bloco);
  }
}
async function alterarStatusAtrib(semanaId, eventoId, uid, status, roleName = "") {
  try {
    await updateDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${uid}`), { status });
    const evSnap = await getDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}`));
    const ev = { id: eventoId, semanaId, ...(evSnap.exists()?evSnap.data():{}) };
    await renderFuncoesEVagas(ev, semanaId);
    if (currentUserRole !== "admin") {
      await callNotifyStatus({
        userName: currentUserName || "",
        userEmail: currentUserEmail || "",
        eventName: ev.nome || "",
        roleName: roleName || "",
        status,
        language: localStorage.getItem("appLang") || "en",
      });
    }
  } catch (e) { alert(tr("alert.statusUpdateError", "Não foi possível atualizar estado: ") + (e?.message || e)); }
}

/* -------------------- UI Atribuições (com transporte/custo/partida/chegada) -------------------- */
async function abrirUIAtribuicoesInline(evento, semanaId) {
  const alvo = document.getElementById(`atribs-${evento.id}`);
  if (!alvo) return;
  alvo.innerHTML = "";

  if (!utilizadoresDisponiveis.length) {
    try {
      const snap = await getDocs(collection(db, "users"));
      utilizadoresDisponiveis = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn("Não foi possível carregar utilizadores:", e); utilizadoresDisponiveis = []; }
  }

  const funcoes = Array.isArray(evento.funcoesDisponiveis) ? evento.funcoesDisponiveis : [];
  if (!funcoes.length) { alvo.innerHTML = `<em>${tr("alert.noRolesForEvent", "Não há funções definidas para este evento.")}</em>`; return; }

  const existentes = new Map(); // funcao -> uid
  const transpExist = new Map(); // funcao -> transporte obj
  const custoExist = new Map(); // funcao -> custoPessoa
  const statusExist = new Map(); // funcao -> status
  try {
    const snap = await getDocs(collection(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes`));
    snap.forEach(d => {
      const a = d.data() || {};
      if (a.funcao) {
        existentes.set(a.funcao, d.id);
        transpExist.set(a.funcao, a.transporte || {});
        if (a.custoPessoa !== undefined) custoExist.set(a.funcao, a.custoPessoa);
        if (a.status) statusExist.set(a.funcao, a.status);
      }
    });
  } catch (e) {}

  const userById = new Map(utilizadoresDisponiveis.map(u => [u.id, u]));

  const linhas = [];
  for (const f of funcoes) {
    const linha = document.createElement("div");
    linha.style.display = "flex";
    linha.style.gap = "8px";
    linha.style.alignItems = "center";
    linha.style.margin = "6px 0";
    linha.style.flexWrap = "wrap";

    const label = document.createElement("span");
    label.textContent = f; label.style.fontWeight = "600"; label.style.minWidth = "160px";

    // Utilizador
    const selectUser = document.createElement("select");
    selectUser.innerHTML = `<option value="">(selecionar)</option>`;
    for (const u of utilizadoresDisponiveis) {
      const opt = document.createElement("option");
      opt.value = u.id; opt.textContent = u.nome || u.email || u.id; selectUser.appendChild(opt);
    }
    if (existentes.has(f)) selectUser.value = existentes.get(f);

    const inpCustoPessoa = document.createElement("input");
    inpCustoPessoa.type = "number";
    inpCustoPessoa.step = "0.01";
    inpCustoPessoa.min = "0";
    inpCustoPessoa.placeholder = t(localStorage.getItem("appLang") || "en", "event.personCost") || "Custo pessoa (€)";

    if (custoExist.has(f)) {
      inpCustoPessoa.value = custoExist.get(f);
    } else if (selectUser.value) {
      const u = userById.get(selectUser.value);
      if (u && u.dailyRate !== undefined && u.dailyRate !== null) inpCustoPessoa.value = u.dailyRate;
    }

    selectUser.addEventListener("change", () => {
      if (inpCustoPessoa.value) return;
      const u = userById.get(selectUser.value);
      if (u && u.dailyRate !== undefined && u.dailyRate !== null) inpCustoPessoa.value = u.dailyRate;
    });

    // Transporte
    const selTipo = document.createElement("select");
    ["", "carro", "comboio", "voo", "outro"].forEach(v=>{
      const o = document.createElement("option"); o.value = v; o.textContent = v ? v[0].toUpperCase()+v.slice(1) : "(transporte)";
      selTipo.appendChild(o);
    });

    const selCarro = document.createElement("select");
    selCarro.style.display = "none";
    selCarro.innerHTML = `<option value="">(carro)</option>` + (produtosConfig.ativos||[])
      .map(a=>`<option value="${a.id}">${a.nome || a.matricula || a.id}</option>`).join("");

    const mkTranspGroup = (labelText) => {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "6px";
      wrap.style.flexWrap = "wrap";
      wrap.style.alignItems = "center";

      const label = document.createElement("span");
      label.className = "muted";
      label.textContent = labelText;

      const selTipo = document.createElement("select");
      ["", "carro", "comboio", "voo", "outro"].forEach(v=>{
        const o = document.createElement("option");
        o.value = v; o.textContent = v ? v[0].toUpperCase()+v.slice(1) : "(transporte)";
        selTipo.appendChild(o);
      });

      const selCarro = document.createElement("select");
      selCarro.style.display = "none";
      selCarro.innerHTML = `<option value="">(carro)</option>` + (produtosConfig.ativos||[])
        .map(a=>`<option value="${a.id}">${a.nome || a.matricula || a.id}</option>`).join("");

      const inpPartida = document.createElement("input"); inpPartida.placeholder = "Partida";
      const inpChegada = document.createElement("input"); inpChegada.placeholder = "Chegada";
      const inpData = document.createElement("input"); inpData.type = "date";
      const inpHora = document.createElement("input"); inpHora.type = "time";

      const inpCusto = document.createElement("input");
      inpCusto.type = "number"; inpCusto.step = "0.01"; inpCusto.min = "0"; inpCusto.placeholder = "Custo (€)";
      inpCusto.style.display = "none";

      selTipo.addEventListener("change", ()=>{
        const isCarro = selTipo.value === "carro";
        selCarro.style.display = isCarro ? "" : "none";
        inpCusto.style.display = isCarro ? "none" : "";
      });

      wrap.appendChild(label);
      wrap.appendChild(selTipo);
      wrap.appendChild(selCarro);
      wrap.appendChild(inpPartida);
      wrap.appendChild(inpChegada);
      wrap.appendChild(inpData);
      wrap.appendChild(inpHora);
      wrap.appendChild(inpCusto);

      return { wrap, selTipo, selCarro, inpPartida, inpChegada, inpData, inpHora, inpCusto };
    };

    const ida = mkTranspGroup("Ida");
    const volta = mkTranspGroup("Volta");

    // Pré-carrega transporte existente (compatível com legado)
    if (transpExist.has(f)) {
      const t = transpExist.get(f) || {};
      const idaT = t.ida || t;
      const voltaT = t.volta || {};

      ida.selTipo.value = idaT.tipo || "";
      ida.selCarro.style.display = (idaT.tipo === "carro") ? "" : "none";
      if (idaT.tipo === "carro") ida.selCarro.value = idaT.carroId || "";
      ida.inpPartida.value = idaT.partida || "";
      ida.inpChegada.value = idaT.chegada || "";
      ida.inpData.value = idaT.data || "";
      ida.inpHora.value = idaT.hora || "";
      if (idaT.tipo && idaT.tipo !== "carro") { ida.inpCusto.style.display = ""; ida.inpCusto.value = idaT.custo ?? ""; }

      volta.selTipo.value = voltaT.tipo || "";
      volta.selCarro.style.display = (voltaT.tipo === "carro") ? "" : "none";
      if (voltaT.tipo === "carro") volta.selCarro.value = voltaT.carroId || "";
      volta.inpPartida.value = voltaT.partida || "";
      volta.inpChegada.value = voltaT.chegada || "";
      volta.inpData.value = voltaT.data || "";
      volta.inpHora.value = voltaT.hora || "";
      if (voltaT.tipo && voltaT.tipo !== "carro") { volta.inpCusto.style.display = ""; volta.inpCusto.value = voltaT.custo ?? ""; }
    }

    const btnSalvar = document.createElement("button");
    btnSalvar.textContent = "Salvar"; btnSalvar.className = "btn";
    btnSalvar.style.background = "#e3f2fd"; btnSalvar.style.border = "1px solid #90caf9";

    const btnEnviarConvite = document.createElement("button");
    btnEnviarConvite.textContent = t(localStorage.getItem("appLang") || "en", "eventUser.sendInvite") || "Enviar convite";
    btnEnviarConvite.className = "btn";
    btnEnviarConvite.style.background = "#fff7ed"; btnEnviarConvite.style.border = "1px solid #fdba74";
    const btnEnviarSemana = document.createElement("button");
    btnEnviarSemana.textContent = t(localStorage.getItem("appLang") || "en", "week.sendInvite") || "Convite semana";
    btnEnviarSemana.className = "btn";
    btnEnviarSemana.style.background = "#fef9c3"; btnEnviarSemana.style.border = "1px solid #facc15";

    btnSalvar.onclick = async () => {
      const uid = selectUser.value;
      if (!uid) { alert(tr("alert.selectUser", "Seleciona um utilizador.")); return; }

      const prevUid = existentes.get(f);
      const status = (prevUid === uid && statusExist.has(f)) ? statusExist.get(f) : "pendente";

      const buildLeg = (leg) => {
        const tipo = leg.selTipo.value || "";
        const obj = {
          tipo,
          carroId: (tipo === "carro") ? (leg.selCarro.value || "") : "",
          partida: getVal(leg.inpPartida) || "",
          chegada: getVal(leg.inpChegada) || "",
          data: getVal(leg.inpData) || "",
          hora: getVal(leg.inpHora) || "",
        };
        if (tipo && tipo !== "carro") obj.custo = parseFloat(leg.inpCusto.value || "0") || 0;
        return obj;
      };
      const transporte = {
        ida: buildLeg(ida),
        volta: buildLeg(volta),
      };
      const custoPessoa = parseFloat(inpCustoPessoa.value || "0");

      try {
        if (prevUid && prevUid !== uid) {
          await deleteDoc(doc(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes/${prevUid}`));
        }
        await setDoc(doc(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes/${uid}`), {
          funcao: f,
          status,
          criadoEm: serverTimestamp(),
          instrucao: "",
          transporte,
          custoPessoa: isNaN(custoPessoa) ? 0 : custoPessoa
        }, { merge: true });

        await renderFuncoesEVagas(evento, semanaId);
        alert(tr("alert.assignmentSaved", "Atribuição registada."));
      } catch (e) { console.error("Erro ao salvar atribuição:", e); alert(tr("alert.assignmentSaveError", "Erro ao salvar atribuição: ") + (e?.message || e)); }
    };

    btnEnviarConvite.onclick = async () => {
      const uid = selectUser.value;
      if (!uid) { alert(tr("alert.selectUser", "Seleciona um utilizador.")); return; }
      const u = userById.get(uid) || {};
      if (!u.email) { alert(tr("alert.emailNotFound", "Email não encontrado.")); return; }
      try {
        const wkSnap = await getDoc(doc(db, `eventos/${semanaId}/convitesSemana/${uid}`));
        const wkStatus = wkSnap.exists() ? (wkSnap.data().status || "pendente") : "";
        if (wkStatus !== "aceite") {
          const ok = confirm(tr("week.confirmSendRole", "A semana ainda não foi aceite. Enviar convite da função na mesma?"));
          if (!ok) return;
        }
      } catch (e) {}
      try {
        await callAssignmentInvite({
          email: u.email,
          userName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.nome || "",
          eventName: evento.nome || "",
          roleName: f,
          startDate: evento.dataInicio || "",
          endDate: evento.dataFim || "",
          deadlineDays: 5,
          eventLink: window.location.origin + "/dashboard.html",
          language: u.language || (localStorage.getItem("appLang") || "en"),
        });
        alert(tr("email.inviteSent", "Convite enviado."));
      } catch (e) {
        alert(tr("email.inviteError", "Erro ao enviar convite: ") + (e?.message || e));
      }
    };

    btnEnviarSemana.onclick = async () => {
      const uid = selectUser.value;
      if (!uid) { alert(tr("alert.selectUser", "Seleciona um utilizador.")); return; }
      const u = userById.get(uid) || {};
      if (!u.email) { alert(tr("alert.emailNotFound", "Email não encontrado.")); return; }
      const weekNum = weekNumberOnly(semanaId);
      const startDate = evento.dataInicio || "";
      const endDate = evento.dataFim || "";
      try {
        await setDoc(doc(db, `eventos/${semanaId}/convitesSemana/${uid}`), {
          status: "pendente",
          invitedAt: serverTimestamp(),
          invitedBy: currentUserUid || null
        }, { merge: true });
        await callWeekInvite({
          uid,
          email: u.email,
          userName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.nome || "",
          adminName: currentUserName || "",
          weekNumber: weekNum,
          startDate,
          endDate,
          events: [{ nome: evento.nome || "", funcoes: Array.isArray(evento.funcoesDisponiveis) ? evento.funcoesDisponiveis : [] }],
          language: u.language || (localStorage.getItem("appLang") || "en"),
          deadlineDays: 5
        });
        alert(tr("week.inviteSent", "Convite de semana enviado."));
      } catch (e) {
        alert(tr("week.inviteError", "Erro ao enviar convite de semana: ") + (e?.message || e));
      }
    };

    const wrap = document.createElement("div");
    wrap.style.display="flex";
    wrap.style.gap="10px";
    wrap.style.alignItems="center";
    wrap.style.flexWrap="wrap";
    wrap.appendChild(ida.wrap);
    wrap.appendChild(volta.wrap);
    wrap.appendChild(inpCustoPessoa);

    linha.appendChild(label);
    linha.appendChild(selectUser);
    linha.appendChild(wrap);
    linha.appendChild(btnSalvar);
    if (currentUserRole === "admin") {
      linha.appendChild(btnEnviarConvite);
      linha.appendChild(btnEnviarSemana);
    }
    alvo.appendChild(linha);

    linhas.push({
      funcao: f,
      selectUser,
      ida,
      volta,
      inpCustoPessoa
    });
  }

  // Botão salvar tudo
  const salvarTudo = document.createElement("button");
  salvarTudo.className = "btn";
  salvarTudo.style.background = "#1e88e5";
  salvarTudo.style.border = "1px solid #1565c0";
  salvarTudo.style.color = "#fff";
  salvarTudo.textContent = t(localStorage.getItem("appLang") || "en", "common.saveAll") || "Guardar tudo";
  salvarTudo.onclick = async () => {
    for (const l of linhas) {
      const uid = l.selectUser.value;
      if (!uid) continue;

      const prevUid = existentes.get(l.funcao);
      const status = (prevUid === uid && statusExist.has(l.funcao)) ? statusExist.get(l.funcao) : "pendente";

      const buildLeg = (leg) => {
        const tipo = leg.selTipo.value || "";
        const obj = {
          tipo,
          carroId: (tipo === "carro") ? (leg.selCarro.value || "") : "",
          partida: getVal(leg.inpPartida) || "",
          chegada: getVal(leg.inpChegada) || "",
          data: getVal(leg.inpData) || "",
          hora: getVal(leg.inpHora) || "",
        };
        if (tipo && tipo !== "carro") obj.custo = parseFloat(leg.inpCusto.value || "0") || 0;
        return obj;
      };
      const transporte = {
        ida: buildLeg(l.ida),
        volta: buildLeg(l.volta),
      };
      const custoPessoa = parseFloat(l.inpCustoPessoa.value || "0");

      try {
        if (prevUid && prevUid !== uid) {
          await deleteDoc(doc(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes/${prevUid}`));
        }
        await setDoc(doc(db, `eventos/${semanaId}/lista/${evento.id}/atribuicoes/${uid}`), {
          funcao: l.funcao,
          status,
          criadoEm: serverTimestamp(),
          instrucao: "",
          transporte,
          custoPessoa: isNaN(custoPessoa) ? 0 : custoPessoa
        }, { merge: true });
      } catch (e) {
        console.error("Erro ao salvar atribuição:", e);
      }
    }
    await renderFuncoesEVagas(evento, semanaId);
    alert(t(localStorage.getItem("appLang") || "en", "common.savedAll") || "Tudo guardado.");
  };
  alvo.prepend(salvarTudo);
}

/* -------------------- Apagar evento -------------------- */
async function apagarEventoComFilhos(semanaId, eventoId) {
  const subpaths = [
    `eventos/${semanaId}/lista/${eventoId}/atribuicoes`,
    `eventos/${semanaId}/lista/${eventoId}/despesas`,
    `eventos/${semanaId}/lista/${eventoId}/viagensCarro`,
    `eventos/${semanaId}/lista/${eventoId}/faturacao/itens`,
  ];
  for (const sp of subpaths) {
    try {
      const snap = await getDocs(collection(db, sp));
      for (const d of snap.docs) await deleteDoc(d.ref);
    } catch (e) { console.warn("Falha a limpar subcoleção", sp, e); }
  }
  try { await deleteDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/faturacao/meta`)); } catch(e){}
  await deleteDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}`));
}

/* -------------------- Modal Detalhes (Despesas + ViagensCarro + Totais) -------------------- */
function bindModaisDetalhes() {
  const modal = $("#modalDetalhesEvento"); if (!modal) return;

  const btnTabDesp = $("#btnTabDespesas");
  const btnTabTot = $("#btnTabTotais");
  const tabDesp = $("#tabDespesas");
  const tabTot = $("#tabTotais");

  btnTabDesp.onclick = () => { tabDesp.style.display = ""; tabTot.style.display = "none"; btnTabDesp.style.background="#e3f2fd"; btnTabDesp.style.border="1px solid #90caf9"; btnTabTot.style.background=""; btnTabTot.style.border=""; };
  btnTabTot.onclick  = () => { tabDesp.style.display = "none"; tabTot.style.display = ""; btnTabTot.style.background="#e3f2fd"; btnTabTot.style.border="1px solid #90caf9"; btnTabDesp.style.background=""; btnTabDesp.style.border=""; };

  $("#fecharModalDetalhes").onclick = ()=> { modal.style.display="none"; };
  const modalPessoa = document.getElementById("modalPessoa");
  const fecharPessoa = document.getElementById("fecharModalPessoa");
  if (fecharPessoa && modalPessoa) fecharPessoa.onclick = ()=> { modalPessoa.style.display = "none"; };
  const mpAceitar = document.getElementById("mpAceitar");
  const mpRecusar = document.getElementById("mpRecusar");
  const mpEnviarConvite = document.getElementById("mpEnviarConvite");
  const mpApagar = document.getElementById("mpApagar");
  if (mpAceitar) mpAceitar.onclick = async () => {
    if (!ctxPessoa.uid || !ctxPessoa.eventoId || !ctxPessoa.semanaId) return;
    await alterarStatusAtrib(ctxPessoa.semanaId, ctxPessoa.eventoId, ctxPessoa.uid, "aceite", ctxPessoa.role || "");
    if (modalPessoa) modalPessoa.style.display = "none";
  };
  if (mpRecusar) mpRecusar.onclick = async () => {
    if (!ctxPessoa.uid || !ctxPessoa.eventoId || !ctxPessoa.semanaId) return;
    await alterarStatusAtrib(ctxPessoa.semanaId, ctxPessoa.eventoId, ctxPessoa.uid, "recusado", ctxPessoa.role || "");
    if (modalPessoa) modalPessoa.style.display = "none";
  };
  if (mpApagar) mpApagar.onclick = async () => {
    if (!ctxPessoa.uid || !ctxPessoa.eventoId || !ctxPessoa.semanaId) return;
    if (!confirm(tr("confirm.removeAssignment", "Remover esta atribuição (função + pessoa)?"))) return;
    await deleteDoc(doc(db, `eventos/${ctxPessoa.semanaId}/lista/${ctxPessoa.eventoId}/atribuicoes/${ctxPessoa.uid}`));
    if (modalPessoa) modalPessoa.style.display = "none";
    const evSnap = await getDoc(doc(db, `eventos/${ctxPessoa.semanaId}/lista/${ctxPessoa.eventoId}`));
    const ev = { id: ctxPessoa.eventoId, semanaId: ctxPessoa.semanaId, ...(evSnap.exists()?evSnap.data():{}) };
    await renderFuncoesEVagas(ev, ctxPessoa.semanaId);
  };
  if (mpEnviarConvite) mpEnviarConvite.onclick = async () => {
    if (!ctxPessoa.email) { alert(tr("alert.emailNotFound", "Email não encontrado.")); return; }
    try {
      const wkSnap = await getDoc(doc(db, `eventos/${ctxPessoa.semanaId}/convitesSemana/${ctxPessoa.uid}`));
      const wkStatus = wkSnap.exists() ? (wkSnap.data().status || "pendente") : "";
      if (wkStatus !== "aceite") {
        const ok = confirm(tr("week.confirmSendRole", "A semana ainda não foi aceite. Enviar convite da função na mesma?"));
        if (!ok) return;
      }
      await callAssignmentInvite({
        email: ctxPessoa.email,
        userName: ctxPessoa.name || "",
        eventName: ctxPessoa.eventName || "",
        roleName: ctxPessoa.role || "",
        startDate: ctxPessoa.eventStart || "",
        endDate: ctxPessoa.eventEnd || "",
        deadlineDays: 5,
        eventLink: window.location.origin + "/dashboard.html",
        language: localStorage.getItem("appLang") || "en",
      });
      alert(tr("email.inviteSent", "Convite enviado."));
    } catch (e) {
      alert(tr("email.inviteError", "Erro ao enviar convite: ") + (e?.message || e));
    }
  };
  $("#btnExportCSV").onclick = exportarDespesasCSV;
  $("#btnCalcularRelatorio").onclick = calcularRelatorioTotais;
  $("#btnSalvarDespesa").onclick = salvarDespesaAtual;
}
async function abrirModalDetalhes(semanaId, eventoId) {
  ctxDetalhes = { semanaId, eventoId, evento: null };
  const modal = $("#modalDetalhesEvento"); if (!modal) return;

  try {
    const s = await getDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}`));
    ctxDetalhes.evento = s.exists() ? s.data() : {};
    $("#detalhesEventoHeader").textContent =
      `${ctxDetalhes.evento?.nome || "(Sem nome)"} • ${ctxDetalhes.evento?.dataInicio || ""}${ctxDetalhes.evento?.dataFim ? " → "+ctxDetalhes.evento.dataFim : ""}`;
  } catch(e){}

  try {
    const sel = $("#despUser");
    if (sel) {
      sel.innerHTML = `<option value="">—</option>`;
      const us = await getDocs(collection(db,"users"));
      const arr = []; us.forEach(d=> arr.push({ id:d.id, ...(d.data()||{}) }));
      arr.sort((a,b)=> String(a.nome||a.email||a.id).localeCompare(String(b.nome||b.email||b.id)));
      for (const u of arr) {
        const opt = document.createElement("option"); opt.value = u.id; opt.textContent = u.nome || u.email || u.id; sel.appendChild(opt);
      }
      const relUser = $("#relUser");
      if (relUser) {
        relUser.innerHTML = `<option value="">(todos)</option>`;
        for (const u of arr) {
          const opt = document.createElement("option");
          opt.value = u.id; opt.textContent = u.nome || u.email || u.id; relUser.appendChild(opt);
        }
      }
    }
  } catch(e){}

  await carregarDespesasEvento();
  await renderViagensCarro();          // usa odómetro
  await calcularTotaisResumo();        // inclui custo carros + custos de transportes não-carro
  modal.style.display = "block";
}
async function carregarDespesasEvento() {
  const corpo = $("#despesasTabela"); if (!corpo) return;
  corpo.innerHTML = `<tr><td colspan="6">A carregar…</td></tr>`;
  const rows = [];
  try {
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas`));
    snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
  } catch(e){}
  rows.sort((a,b)=> String(a.data||"").localeCompare(String(b.data||"")));
  corpo.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.data || "-"}</td>
      <td>${r.categoria || "-"}</td>
      <td>€ ${toMoney(r.valor)}</td>
      <td>${r.userId || "-"}</td>
      <td>${r.nota || "-"}</td>
      <td><button class="btn" data-desp-del="${r.id}">Apagar</button></td>
    `;
    corpo.appendChild(tr);
  }
  corpo.querySelectorAll("[data-desp-del]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-desp-del");
      if (!confirm(tr("confirm.deleteExpense", "Apagar esta despesa?"))) return;
      await deleteDoc(doc(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas/${id}`));
      await carregarDespesasEvento();
      await calcularTotaisResumo();
    };
  });
}
async function salvarDespesaAtual() {
  const data  = getVal($("#despData"));
  const cat   = getVal($("#despCategoria"));
  const valor = parseFloat(getVal($("#despValor")||0)) || 0;
  const uid   = getVal($("#despUser"));
  const nota  = getVal($("#despNota"));
  if (!data || !cat) { alert(tr("alert.needDateCategory", "Indica a Data e a Categoria.")); return; }

  await addDoc(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas`), {
    data, categoria: cat, valor, userId: uid || null, nota: nota || null, criadoEm: serverTimestamp()
  });
  $("#despData").value=""; $("#despCategoria").value=""; $("#despValor").value=""; $("#despUser").value=""; $("#despNota").value="";
  await carregarDespesasEvento();
  await calcularTotaisResumo();
}
async function exportarDespesasCSV() {
  const rows = [["Data","Categoria","Valor","User","Nota"]];
  try {
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas`));
    snap.forEach(d=>{
      const r = d.data()||{};
      rows.push([r.data||"", r.categoria||"", String(r.valor||0).replace(".",","), r.userId||"", r.nota||""]);
    });
  } catch(e){}
  rows.push([]);
  rows.push(["Carro","Odómetro início","Odómetro fim","TotalKm","€/km","Custo"]);
  try{
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/viagensCarro`));
    snap.forEach(d=>{
      const carId = d.id; const r = d.data()||{};
      const ativo = (produtosConfig.ativos||[]).find(a=>a.id===carId) || {};
      const precoKm = Number(ativo.precoKm||0);
      const odIni = Number(r.odInicio||0);
      const odFim = Number(r.odFim||0);
      const totKm = Math.max(0, odFim - odIni);
      const custo = totKm * precoKm;
      rows.push([ativo.nome||ativo.matricula||carId, odIni, odFim, totKm, precoKm, custo]);
    });
  }catch(e){}

  const csv = rows.map(r=> r.map(x=> `"${String(x).replaceAll(`"`,`""`)}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `despesas_${ctxDetalhes.semanaId}_${ctxDetalhes.eventoId}.csv`; a.click();
  URL.revokeObjectURL(url);
}
async function calcularTotaisResumo() {
  const div = $("#totaisResumo"); if (!div) return;
  div.innerHTML = "";

  let totalDespesas = 0;
  try{
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas`));
    snap.forEach(d=>{ totalDespesas += Number((d.data()||{}).valor || 0); });
  }catch(e){}

  // custos de transportes NÃO-carro (somatório por atribuição)
  let custoTransportesNaoCarro = 0;
  try{
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/atribuicoes`));
    snap.forEach(d=>{
      const t = (d.data()||{}).transporte || {};
      if (t.tipo && t.tipo !== "carro") custoTransportesNaoCarro += Number(t.custo || 0);
    });
  }catch(e){}

  // custo carros por odómetro
  let custoCarros = 0;
  try{
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/viagensCarro`));
    snap.forEach(d=>{
      const carId = d.id; const r = d.data() || {};
      const ativo = (produtosConfig.ativos||[]).find(a=>a.id===carId) || {};
      const precoKm = Number(ativo.precoKm||0);
      const odIni = Number(r.odInicio||0);
      const odFim = Number(r.odFim||0);
      const totKm = Math.max(0, odFim - odIni);
      custoCarros += totKm * precoKm;
    });
  }catch(e){}

  const total = totalDespesas + custoTransportesNaoCarro + custoCarros;

  div.innerHTML = `
    <div><strong>Total despesas diretas:</strong> € ${toMoney(totalDespesas)}</div>
    <div><strong>Transportes (não-carro):</strong> € ${toMoney(custoTransportesNaoCarro)}</div>
    <div data-extra-carros><strong>Custo viagens (carros):</strong> € ${toMoney(custoCarros)}</div>
    <div><strong>Total geral:</strong> € ${toMoney(total)}</div>
  `;
}

/* ---- ViagensCarro: ODOMETRO (odInicio/odFim) por carro, 1x por evento ---- */
async function renderViagensCarro() {
  const tabDesp = $("#tabDespesas"); if (!tabDesp) return;

  const antigo = tabDesp.querySelector("[data-viagens-carro]"); if (antigo) antigo.remove();

  const host = document.createElement("div");
  host.className = "card"; host.setAttribute("data-viagens-carro","1"); host.style.marginTop = "12px";
  host.innerHTML = `
    <h4>🚗 Viagens (carros) — odómetro início/fim (kms = fim − início)</h4>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:8px;">
      <div>
        <label>Carro</label>
        <select id="kmCarroSel">
          <option value="">—</option>
          ${(produtosConfig.ativos||[]).map(a=>`<option value="${a.id}">${a.nome||a.matricula||a.id}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Odómetro início</label>
        <input id="odInicio" type="number" step="0.1" min="0" placeholder="0">
      </div>
      <div>
        <label>Odómetro fim</label>
        <input id="odFim" type="number" step="0.1" min="0" placeholder="0">
      </div>
      <div>
        <button id="kmGuardar" class="btn-primary">Guardar/Atualizar</button>
      </div>
    </div>
    <table>
      <thead><tr><th>Carro</th><th>Odo. início</th><th>Odo. fim</th><th>Total kms</th><th>€/km</th><th>Custo (€)</th><th></th></tr></thead>
      <tbody id="kmTabela"><tr><td colspan="7">A carregar…</td></tr></tbody>
    </table>
  `;
  tabDesp.appendChild(host);

  const kmTabela = host.querySelector("#kmTabela");

  async function loadRows(){
    kmTabela.innerHTML = "<tr><td colspan='7'>A carregar…</td></tr>";
    const rows = [];
    try{
      const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/viagensCarro`));
      snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
    }catch(e){}

    kmTabela.innerHTML = "";
    if (!rows.length) { kmTabela.innerHTML = "<tr><td colspan='7'>Sem registos.</td></tr>"; return; }

    for (const r of rows){
      const ativo = (produtosConfig.ativos||[]).find(a=>a.id===r.id) || {};
      const nome = ativo.nome || ativo.matricula || r.id;
      const precoKm = Number(ativo.precoKm||0);
      const odIni = Number(r.odInicio||0);
      const odFim = Number(r.odFim||0);
      const totKm = Math.max(0, odFim - odIni);
      const custo = totKm * precoKm;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${nome}</td>
        <td>${odIni}</td>
        <td>${odFim}</td>
        <td>${totKm}</td>
        <td>${toMoney(precoKm)}</td>
        <td>€ ${toMoney(custo)}</td>
        <td><button class="btn" data-km-del="${r.id}">Apagar</button></td>
      `;
      kmTabela.appendChild(tr);
    }

    kmTabela.querySelectorAll("[data-km-del]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-km-del");
        if (!confirm(tr("confirm.deleteTrip", "Apagar registo deste carro?"))) return;
        await deleteDoc(doc(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/viagensCarro/${id}`));
        await loadRows(); await calcularTotaisResumo();
      };
    });
  }

  async function saveCurrent(){
    const carId = host.querySelector("#kmCarroSel").value;
    const odInicio = parseFloat(host.querySelector("#odInicio").value || "0") || 0;
    const odFim = parseFloat(host.querySelector("#odFim").value || "0") || 0;
    if (!carId) { alert(tr("alert.chooseCar", "Escolhe um carro.")); return; }
    await setDoc(doc(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/viagensCarro/${carId}`), {
      odInicio, odFim, atualizadoEm: serverTimestamp()
    }, { merge:true });
    await loadRows();
    host.querySelector("#odInicio").value = "";
    host.querySelector("#odFim").value = "";
    await calcularTotaisResumo();
  }

  host.querySelector("#kmGuardar").onclick = saveCurrent;
  await loadRows();
}

/* -------------------- Modal Faturação -------------------- */
function bindModalFaturacao() {
  const modal = $("#modalFaturacao"); if (!modal) return;
  $("#fatFechar").onclick = ()=> { modal.style.display="none"; };
  $("#fatAdd").onclick = adicionarItemFaturacao;
  $("#fatExportCSV").onclick = exportarFaturacaoCSV;
}
async function abrirModalFaturacao(semanaId, eventoId) {
  ctxFat = { semanaId, eventoId };
  const modal = $("#modalFaturacao"); if (!modal) return;
  $("#fatHeader").textContent = `${semanaId} • ${eventoId}`;
  await carregarFaturacaoMeta();
  await preencherProdutosFaturacao();
  await carregarItensFaturacao();
  modal.style.display = "block";
}
async function carregarFaturacaoMeta(){
  const ref = doc(db, `eventos/${ctxFat.semanaId}/lista/${ctxFat.eventoId}/faturacao/meta`);
  const s = await getDoc(ref);
  if (s.exists()) {
    const m = s.data()||{};
    setVal($("#fatCliente"), m.cliente||"");
    setVal($("#fatDoc"), m.doc||"");
    setVal($("#fatData"), m.data||"");
    setVal($("#fatEstado"), m.estado||"");
  } else { setVal($("#fatCliente"), ""); setVal($("#fatDoc"), ""); setVal($("#fatData"), ""); setVal($("#fatEstado"), ""); }
  ["fatCliente","fatDoc","fatData","fatEstado"].forEach(id=>{
    const el = document.getElementById(id);
    el.onchange = async ()=>{
      await setDoc(ref, {
        cliente: getVal($("#fatCliente")) || null,
        doc: getVal($("#fatDoc")) || null,
        data: getVal($("#fatData")) || null,
        estado: getVal($("#fatEstado")) || null,
        atualizadoEm: serverTimestamp()
      }, { merge:true });
    };
  });
}
async function preencherProdutosFaturacao(){
  const sel = $("#fatProduto"); if (!sel) return;
  const tipo = $("#fatTipo").value;
  sel.innerHTML = `<option value="">—</option>`;
  const lista = tipo === "servico" ? (produtosConfig.servicos||[]) : (produtosConfig.despesas||[]);
  for (const p of lista) {
    const opt = document.createElement("option");
    opt.value = p.id; opt.textContent = p.nome || p.id;
    opt.dataset.custo = p.custoPadrao ?? 0; opt.dataset.venda = p.vendaPadrao ?? 0;
    sel.appendChild(opt);
  }
  sel.onchange = ()=>{
    const o = sel.selectedOptions[0]; if (!o) return;
    $("#fatCusto").value = String(parseFloat(o.dataset.custo||"0")||0);
    $("#fatFatur").value = String(parseFloat(o.dataset.venda||"0")||0);
  };
}
$("#fatTipo")?.addEventListener("change", preencherProdutosFaturacao);

async function adicionarItemFaturacao(){
  const tipo = getVal($("#fatTipo")) || "servico";
  const prod = $("#fatProduto").value;
  const qtde = parseFloat($("#fatQtde").value||"1")||1;
  const custo = parseFloat($("#fatCusto").value||"0")||0;
  const fatur = parseFloat($("#fatFatur").value||"0")||0;
  if (!prod) { alert(tr("alert.chooseProduct", "Escolhe um produto.")); return; }
  const lista = tipo === "servico" ? (produtosConfig.servicos||[]) : (produtosConfig.despesas||[]);
  const found = lista.find(x=>x.id===prod) || {};
  const nome = found.nome || prod;

  await addDoc(collection(db, `eventos/${ctxFat.semanaId}/lista/${ctxFat.eventoId}/faturacao/itens`), {
    tipo, produtoId: prod, nome, qtde, custo, fatur, criadoEm: serverTimestamp()
  });
  $("#fatProduto").value=""; $("#fatQtde").value="1"; $("#fatCusto").value=""; $("#fatFatur").value="";
  await carregarItensFaturacao();
}
async function carregarItensFaturacao(){
  const corpo = $("#fatTabela");
  const tCusto = $("#fatTotalCusto");
  const tFatur = $("#fatTotalFatur");
  const tMarg  = $("#fatMargem");
  if (!corpo) return;
  corpo.innerHTML = `<tr><td colspan="6">A carregar…</td></tr>`;

  const rows = [];
  try {
    const snap = await getDocs(collection(db, `eventos/${ctxFat.semanaId}/lista/${ctxFat.eventoId}/faturacao/itens`));
    snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
  } catch(e){}
  corpo.innerHTML = "";

  let totalC=0, totalF=0;
  for (const r of rows) {
    const c = Number(r.qtde||0) * Number(r.custo||0);
    const f = Number(r.qtde||0) * Number(r.fatur||0);
    totalC+=c; totalF+=f;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.tipo}</td>
      <td>${r.nome||r.produtoId}</td>
      <td>${r.qtde}</td>
      <td>€ ${toMoney(r.custo)}</td>
      <td>€ ${toMoney(r.fatur)}</td>
      <td><button class="btn" data-fat-del="${r.id}">Apagar</button></td>
    `;
    corpo.appendChild(tr);
  }
  corpo.querySelectorAll("[data-fat-del]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-fat-del");
      if (!confirm(tr("confirm.deleteItem", "Apagar item?"))) return;
      await deleteDoc(doc(db, `eventos/${ctxFat.semanaId}/lista/${ctxFat.eventoId}/faturacao/itens/${id}`));
      await carregarItensFaturacao();
    };
  });

  if (tCusto) tCusto.textContent = toMoney(totalC);
  if (tFatur) tFatur.textContent = toMoney(totalF);
  if (tMarg)  tMarg.textContent  = toMoney(totalF - totalC);
}
async function exportarFaturacaoCSV(){
  const rows = [["Tipo","Produto","Qtde","Custo","Faturacao"]];
  try {
    const snap = await getDocs(collection(db, `eventos/${ctxFat.semanaId}/lista/${ctxFat.eventoId}/faturacao/itens`));
    snap.forEach(d=>{
      const r = d.data()||{};
      rows.push([r.tipo||"", r.nome||r.produtoId||"", r.qtde||0, r.custo||0, r.fatur||0]);
    });
  } catch(e){}
  const csv = rows.map(r=> r.map(x=> `"${String(x).replaceAll(`"`,`""`)}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `faturacao_${ctxFat.semanaId}_${ctxFat.eventoId}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* -------------------- Relatório Totais -------------------- */
async function calcularRelatorioTotais(){
  const ini = getVal($("#relInicio"));
  const fim = getVal($("#relFim"));
  const uid = $("#relUser")?.value || "";
  const res = [];
  try {
    const snap = await getDocs(collection(db, `eventos/${ctxDetalhes.semanaId}/lista/${ctxDetalhes.eventoId}/despesas`));
    snap.forEach(d=>{
      const r = d.data() || {};
      if (ini && String(r.data||"") < ini) return;
      if (fim && String(r.data||"") > fim) return;
      if (uid && (r.userId !== uid)) return;
      res.push(r);
    });
  }catch(e){}
  const total = res.reduce((s, r)=> s + Number(r.valor||0), 0);
  $("#relatorioResultado").innerHTML = `
    <div><strong>Registos:</strong> ${res.length}</div>
    <div><strong>Total no período:</strong> € ${toMoney(total)}</div>
  `;
}

/* -------------------- Global clicks -------------------- */
async function onGlobalClicks(e){
  const del = e.target.closest("button[data-apagar-evento]");
  if (del) {
    if ((localStorage.getItem("userRole") || currentUserRole) !== "admin") return;
    const semanaId = del.getAttribute("data-semana");
    const eventoId = del.getAttribute("data-id");
    if (!confirm(tr("confirm.deleteEvent", "Apagar evento e sub-registos?"))) return;
    try { await apagarEventoComFilhos(semanaId, eventoId); await carregarTodosEventosCronologico(); }
    catch (err) { alert(tr("alert.deleteError", "Erro ao apagar: ") + (err?.message || err)); }
    return;
  }
  const det = e.target.closest("button[data-detalhes-evento]");
  if (det) { await abrirModalDetalhes(det.getAttribute("data-semana"), det.getAttribute("data-id")); return; }
  const fat = e.target.closest("button[data-faturacao-evento]");
  if (fat) { await abrirModalFaturacao(fat.getAttribute("data-semana"), fat.getAttribute("data-id")); return; }
  const weekAccept = e.target.closest("button[data-week-accept]");
  if (weekAccept) {
    const semanaId = weekAccept.getAttribute("data-semana");
    if (!currentUserUid) return;
    await setDoc(doc(db, `eventos/${semanaId}/convitesSemana/${currentUserUid}`), { status: "aceite", respondedAt: serverTimestamp() }, { merge: true });
    await carregarTodosEventosCronologico();
    try {
      await callNotifyStatus({
        userName: currentUserName || "",
        userEmail: currentUserEmail || "",
        eventName: `Semana ${weekNumberOnly(semanaId)}`,
        roleName: "Convite de semana",
        status: "aceite",
        language: localStorage.getItem("appLang") || "en",
      });
    } catch (e) {}
    return;
  }
  const weekReject = e.target.closest("button[data-week-reject]");
  if (weekReject) {
    const semanaId = weekReject.getAttribute("data-semana");
    if (!currentUserUid) return;
    await setDoc(doc(db, `eventos/${semanaId}/convitesSemana/${currentUserUid}`), { status: "recusado", respondedAt: serverTimestamp() }, { merge: true });
    await carregarTodosEventosCronologico();
    try {
      await callNotifyStatus({
        userName: currentUserName || "",
        userEmail: currentUserEmail || "",
        eventName: `Semana ${weekNumberOnly(semanaId)}`,
        roleName: "Convite de semana",
        status: "recusado",
        language: localStorage.getItem("appLang") || "en",
      });
    } catch (e) {}
    return;
  }
  const sendWeek = e.target.closest("button[data-send-week-invites]");
  if (sendWeek) {
    if ((localStorage.getItem("userRole") || currentUserRole) !== "admin") return;
    const semanaId = sendWeek.getAttribute("data-semana");
    await enviarConvitesSemana(semanaId);
    return;
  }
  const tog = e.target.closest("button[data-toggle-visibility]");
  if (tog) {
    if ((localStorage.getItem("userRole") || currentUserRole) !== "admin") return;
    const semanaId = tog.getAttribute("data-semana");
    const eventoId = tog.getAttribute("data-id");
    const isVisible = tog.getAttribute("data-visible") === "1";
    try {
      await updateDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}`), { visibleToUsers: !isVisible });
      await carregarTodosEventosCronologico();
    } catch (err) {
      alert(tr("alert.visibilityError", "Erro ao atualizar visibilidade: ") + (err?.message || err));
    }
    return;
  }
}

async function enviarConvitesSemana(semanaId) {
  const lang = localStorage.getItem("appLang") || "en";
  const eventosSnap = await getDocs(collection(db, `eventos/${semanaId}/lista`));
  const eventos = [];
  eventosSnap.forEach(d => {
    const ev = d.data() || {};
    eventos.push({
      id: d.id,
      nome: ev.nome || "",
      dataInicio: ev.dataInicio || "",
      dataFim: ev.dataFim || "",
      funcoesDisponiveis: Array.isArray(ev.funcoesDisponiveis) ? ev.funcoesDisponiveis : []
    });
  });
  if (!eventos.length) { alert(tr("alert.noEventsThisWeek", "Sem eventos nesta semana.")); return; }

  const usuariosSet = new Map();
  for (const ev of eventos) {
    const atribSnap = await getDocs(collection(db, `eventos/${semanaId}/lista/${ev.id}/atribuicoes`));
    atribSnap.forEach(d => {
      const a = d.data() || {};
      if (d.id) {
        if (!usuariosSet.has(d.id)) usuariosSet.set(d.id, { eventos: [] });
        usuariosSet.get(d.id).eventos.push({
          nome: ev.nome,
          funcoes: Array.isArray(ev.funcoesDisponiveis) ? ev.funcoesDisponiveis : []
        });
      }
    });
  }
  if (!usuariosSet.size) { alert(tr("alert.noPreplannedUsers", "Sem utilizadores pre‑planeados.")); return; }

  if (!utilizadoresDisponiveis.length) {
    const snap = await getDocs(collection(db, "users"));
    utilizadoresDisponiveis = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const userById = new Map(utilizadoresDisponiveis.map(u => [u.id, u]));

  const weekNum = weekNumberOnly(semanaId);
  const minDate = eventos.reduce((m, e) => !m || (e.dataInicio && e.dataInicio < m) ? e.dataInicio : m, "");
  const maxDate = eventos.reduce((m, e) => !m || (e.dataFim && e.dataFim > m) ? e.dataFim : m, "");

  for (const [uid, info] of usuariosSet.entries()) {
    const u = userById.get(uid) || {};
    if (!u.email) continue;
    await setDoc(doc(db, `eventos/${semanaId}/convitesSemana/${uid}`), {
      status: "pendente",
      invitedAt: serverTimestamp(),
      invitedBy: currentUserUid || null
    }, { merge: true });

    await callWeekInvite({
      uid,
      email: u.email,
      userName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.nome || "",
      adminName: currentUserName || "",
      weekNumber: weekNum,
      startDate: minDate,
      endDate: maxDate,
      events: info.eventos,
      language: u.language || lang,
      deadlineDays: 5
    });
  }
  alert(tr("week.invitesSent", "Convites de semana enviados."));
}

/* -------------------- Manutenção estrutura atribuições -------------------- */
async function atualizarEstruturaAtribuicoes(semanaId) {
  const eventosSnap = await getDocs(collection(db, `eventos/${semanaId}/lista`));
  for (const eventoDoc of eventosSnap.docs) {
    const eventoId = eventoDoc.id;
    const atribsSnap = await getDocs(collection(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes`));
    for (const aDoc of atribsSnap.docs) {
      const uid = aDoc.id;
      const data = aDoc.data();
      const patch = {};
      if (!("instrucao" in data)) patch.instrucao = "";
      if (!("transporte" in data)) {
        patch.transporte = { tipo: "", carroId: "", partida: "", chegada: "", custo: 0 };
      }
      if (Object.keys(patch).length > 0) {
        await updateDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${uid}`), patch);
        console.log(`Atualizado: ${eventoId} / ${uid}`);
      }
    }
  }
}
window.atualizarEstruturaAtribuicoesSemanaAtual = async function () {
  const semanasSnap = await getDocs(collection(db, "eventos"));
  for (const s of semanasSnap.docs) {
    await atualizarEstruturaAtribuicoes(s.id);
  }
};

/* -------------------- Debug helper -------------------- */
window.debugFirestore = async function() {
  const cg = await getDocs(collectionGroup(db, "lista"));
  console.log("collectionGroup(lista) docs:", cg.size);
  cg.forEach(d => console.log("doc:", d.ref.path, d.data()));
  const idx = await getDocs(collection(db, "eventos"));
  console.log("indice eventos:", idx.size, idx.docs.map(d=>d.id));
};
