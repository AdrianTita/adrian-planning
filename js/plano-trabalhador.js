import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, setDoc, doc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";

window.addEventListener("DOMContentLoaded", function() {

const container = document.getElementById("containerSemanas");
let currentLang = localStorage.getItem("appLang") || "en";

const STATUS_INFO = {
  pendente: { texto: () => (t(currentLang, "status.pending") || "PENDENTE"), cor: "orange" },
  aceite: { texto: () => (t(currentLang, "status.accepted") || "ACEITE"), cor: "green" },
  rejeitada: { texto: () => (t(currentLang, "status.rejected") || "REJEITADA"), cor: "red" }
};

window.responderAtribuicao = async (eventoId, novoStatus) => {
  const user = auth.currentUser;
  if (!user) return;

  const uid = user.uid;
  const semanaId = eventoId.split("-")[0];

  const atribPath = `users/${uid}/historicoAtribuicoes/${eventoId}`;
  const eventoAtribPath = `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${uid}`;

  try {
    await setDoc(
      doc(db, `users/${uid}/historicoAtribuicoes/${eventoId}`),
      { status: novoStatus },
      { merge: true }
    );
  } catch (error) {
    console.error("Erro ao atualizar histórico de atribuições do utilizador:", error);
  }
  try {
    const querySnapshot = await getDocs(collection(db, `users/${user.uid}/historicoAtribuicoes`));
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      // processar dados...
    });
  } catch (error) {
    console.error("Erro ao buscar atribuições do utilizador:", error);
  }

  alert(`${t(currentLang, "workerPlan.statusUpdated") || "Status atualizado para"} "${novoStatus.toUpperCase()}"`);
  location.reload();
};

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  currentLang = await initUserLanguage(user.uid);
  const langSelect = document.getElementById("langSelect");
  bindLanguageSelector(langSelect, user.uid, currentLang);
  if (langSelect) {
    langSelect.addEventListener("change", () => {
      location.reload();
    });
  }

  const uid = user.uid;

  const semanasRef = collection(db, "eventos");
  const semanasSnap = await getDocs(semanasRef);

  const historicoSnap = await getDocs(collection(db, `users/${uid}/historicoAtribuicoes`));
  const historicoMap = {};
  historicoSnap.forEach(doc => historicoMap[doc.id] = doc.data());

  for (const semanaDoc of semanasSnap.docs) {
    const semanaId = semanaDoc.id;
    const eventosRef = collection(db, `eventos/${semanaId}/lista`);
    const eventosSnap = await getDocs(eventosRef);

    const eventosFiltrados = eventosSnap.docs.filter(ev => {
      const data = ev.data();
      return Object.values(data.funcoes || {}).some(f => f.uid === user.uid);
    });

    if (eventosFiltrados.length === 0) continue;

    const bloco = document.createElement("div");
    bloco.className = "semana-block";
    bloco.innerHTML = `<div class="semana-header">🗓 ${t(currentLang, "workerPlan.week") || "Semana"} ${semanaId}</div>`;

    eventosFiltrados.forEach(docEvento => {
      const evento = docEvento.data();
      const eventoId = docEvento.id;
      const funcoesUser = Object.entries(evento.funcoes || {}).filter(([_, f]) => f.uid === user.uid);

      const eventoEl = document.createElement("div");
      eventoEl.className = "evento";
      eventoEl.innerHTML = `
        <h3>🎪 ${evento.nome}</h3>
        <p><strong>📍 ${t(currentLang, "event.location") || "Local"}:</strong> ${evento.local}</p>
        <p><strong>📅 ${t(currentLang, "event.date") || "Data"}:</strong> ${evento.dataInicio || evento.data}</p>
      `;

      const funcoesBox = document.createElement("div");
      funcoesBox.className = "funcoes";

      funcoesUser.forEach(([funcao, dados], idx) => {
        const idDiv = `${eventoId}-${idx}`;
        const status = (historicoMap[eventoId]?.status) || "pendente";
        const info = STATUS_INFO[status];

        const div = document.createElement("div");
        div.className = "funcao-box";
        div.style.border = `2px solid ${info.cor}`;
        div.innerHTML = `
          ${funcao} - <strong style="color:${info.cor}">${info.texto()}</strong><br>
          <button style="margin-top:5px" ${status !== "pendente" ? "disabled" : ""} onclick="responderAtribuicao('${eventoId}', 'aceite')">✅ ${t(currentLang, "eventUser.accept") || "Aceitar"}</button>
          <button ${status !== "pendente" ? "disabled" : ""} onclick="responderAtribuicao('${eventoId}', 'rejeitada')">❌ ${t(currentLang, "eventUser.reject") || "Rejeitar"}</button>
        `;
        funcoesBox.appendChild(div);
      });

      eventoEl.appendChild(funcoesBox);
      bloco.appendChild(eventoEl);
    });

    container.appendChild(bloco);
  }
});
});
