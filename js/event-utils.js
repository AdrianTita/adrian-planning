// event-utils.js (limpo e consolidado)
import { db } from "./firebase-config.js";
import {
  doc, setDoc, getDoc, getDocs, collection
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/** Retorna número da semana ISO 8601 */
export function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

/** Ex.: "2025-S39" a partir de "YYYY-MM-DD" */
export function getSemanaIdFromData(dataISO) {
  const d = new Date(dataISO);
  return getSemanaIdFromDate(d);
}

export function getSemanaIdFromDate(d) {
  const year = d.getFullYear();
  const week = getWeekNumber(d);
  return `${year}-S${String(week).padStart(2, "0")}`;
}

/** Gera ID legível para evento */
export function gerarIdEvento(nome, dataISO) {
  const base = String(nome || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_\-]/g, "");
  return `${base}-${getSemanaIdFromData(dataISO)}`;
}

/** Extrai semanaId de um eventoId no formato "<nome>-YYYY-SNN" */
export function getSemanaIdFromEventoId(eventoId) {
  const m = eventoId.match(/-(\d{4}-S\d{2})$/);
  return m ? m[1] : "";
}

/** Carrega atribuições de um evento */
export async function carregarAtribuicoes(eventoId) {
  const semanaId = getSemanaIdFromEventoId(eventoId);
  const ref = collection(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes`);
  const snap = await getDocs(ref);
  const atribuicoes = [];
  snap.forEach(docSnap => {
    atribuicoes.push({ userId: docSnap.id, ...docSnap.data() });
  });
  return atribuicoes;
}

/** Guarda estrutura mínima de evento */
export async function guardarEventoBasico({ nome, inicioISO, fimISO = "", local = "", responsavel = "", obs = "", funcoes = [] }) {
  const semanaId = getSemanaIdFromData(inicioISO);
  const eventoId = gerarIdEvento(nome, inicioISO);
  const ref = doc(db, `eventos/${semanaId}/lista/${eventoId}`);
  await setDoc(ref, { nome, inicio: inicioISO, fim: fimISO, local, responsavel, obs, funcoes }, { merge: true });
  return { semanaId, eventoId };
}

/** Renderiza uma UL simples com funções disponíveis num container */
export function renderizarFuncoesDisponiveis(funcoes, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(funcoes) || funcoes.length === 0) return;
  const ul = document.createElement("ul");
  funcoes.forEach(f => {
    const li = document.createElement("li");
    li.textContent = f;
    ul.appendChild(li);
  });
  container.appendChild(ul);
}
