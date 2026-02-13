import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, getDocs, setDoc, collection
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getSemanaIdFromEventoId, carregarEventoDados, carregarAtribuicoes } from "./event-utils.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";

window.addEventListener("DOMContentLoaded", function() {
const salvarBtn = document.getElementById("salvarEdicaoBtn");
let currentLang = localStorage.getItem("appLang") || "en";

const eventoData = document.getElementById("eventoData");
const eventoLocal = document.getElementById("eventoLocal");
const eventoIdEl = document.getElementById("eventoId");
const funcoesLista = document.getElementById("funcoesLista");

const userSelect = document.getElementById("userSelect");
const funcaoSelect = document.getElementById("funcaoSelect");
const atribuirBtn = document.getElementById("atribuirBtn");
const atribuicoesLista = document.getElementById("atribuicoesLista");
const urlParams = new URLSearchParams(window.location.search);
const eventoId = urlParams.get("id");
if (!eventoId) {
  document.getElementById("eventoContainer").textContent = t(currentLang, "event.notFound") || "Evento não encontrado.";
  return;
}

async function carregarEvento() {
  const evento = await carregarEventoDados(eventoId);
  if (!evento) {
    eventoNome.textContent = t(currentLang, "event.notFound") || "Evento não encontrado";
    return;
  }

  const semanaId = getSemanaIdFromEventoId(eventoId);

  eventoNome.textContent = evento.nome;
  eventoData.textContent = evento.data;
  eventoLocal.textContent = evento.local;
  eventoIdEl.textContent = eventoId;

  mostrarFuncoes(evento.funcoesDisponiveis || [], await carregarAtribuicoes(eventoId));
  carregarAtribuicoesNaUI(semanaId);
}

function mostrarFuncoes(funcoesDisponiveis, atribuicoes) {
  funcoesLista.innerHTML = "";

  funcoesDisponiveis.forEach(func => {
    const atribuicao = atribuicoes.find(a => a.funcao === func);
    const li = document.createElement("li");
    li.innerHTML = atribuicao
      ? `<strong>${func}</strong> — ${t(currentLang, "event.assignedTo") || "atribuído a"} <em>${atribuicao.userId}</em>`
      : `<strong>${func}</strong> — <span style="color:orange">${t(currentLang, "event.unassigned") || "por atribuir"}</span>`;
    funcoesLista.appendChild(li);
  });
}

async function carregarAtribuicoesNaUI(semanaId) {
  const atribuicoes = await carregarAtribuicoes(eventoId);
  atribuicoesLista.innerHTML = "";

  atribuicoes.forEach(({ userId, funcao, status, viagem }) => {
    const div = document.createElement("div");
    div.className = "atribuicao";

    const viagemIda = viagem?.ida;
    const viagemVolta = viagem?.volta;

    const viagemResumo = `
      <div style="margin-top: 6px; font-size: 0.9em">
        <strong>🚗 ${t(currentLang, "event.outbound") || "Ida"}:</strong> ${viagemIda?.data || "-"} ${viagemIda?.hora || ""}, 
        ${viagemIda?.partida || ""} ➡ ${viagemIda?.chegada || ""} (${viagemIda?.transporte || "-"})<br>
        <strong>↩ ${t(currentLang, "event.return") || "Volta"}:</strong> ${viagemVolta?.data || "-"} ${viagemVolta?.hora || ""}, 
        ${viagemVolta?.partida || ""} ➡ ${viagemVolta?.chegada || ""} (${viagemVolta?.transporte || "-"})
      </div>
    `;

    div.innerHTML = `
      👤 <strong>${userId}</strong> — <em>${funcao}</em> 
      <span style="color: ${statusCor(status)}">(${status})</span>
      <button style="margin-left: 10px" onclick="removerAtribuicao('${userId}')">🗑 ${t(currentLang, "common.delete") || "Remover"}</button>
      ${viagemResumo}
    `;

    atribuicoesLista.appendChild(div);
  });
}

window.removerAtribuicao = async (userId) => {
  const semanaId = getSemanaIdFromEventoId(eventoId);

  await setDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${userId}`), {}, { merge: false });
  await setDoc(doc(db, `users/${userId}/historicoAtribuicoes/${eventoId}`), {}, { merge: false });

  alert(t(currentLang, "event.assignmentRemoved") || "Atribuição removida!");
  carregarAtribuicoesNaUI(semanaId);
};

function statusCor(status) {
  if (status === "aceite") return "green";
  if (status === "rejeitada") return "red";
  return "orange";
}

atribuirBtn.onclick = async () => {
  const userId = userSelect.value;
  const funcao = funcaoSelect.value;
  const semanaId = getSemanaIdFromEventoId(eventoId);

  const viagem = {
    ida: {
      data: document.getElementById("idaData").value,
      hora: document.getElementById("idaHora").value,
      partida: document.getElementById("idaPartida").value,
      chegada: document.getElementById("idaChegada").value,
      transporte: document.getElementById("idaTransporte").value,
    },
    volta: {
      data: document.getElementById("voltaData").value,
      hora: document.getElementById("voltaHora").value,
      partida: document.getElementById("voltaPartida").value,
      chegada: document.getElementById("voltaChegada").value,
      transporte: document.getElementById("voltaTransporte").value,
    }
  };

  const atribuicao = {
    funcao,
    status: "pendente",
    nota: "",
    viagem
  };

  try {
    await setDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${userId}`), atribuicao);
    await setDoc(doc(db, `users/${userId}/historicoAtribuicoes/${eventoId}`), {
      funcao,
      status: "pendente",
      eventoId,
      viagem
    });

    alert(t(currentLang, "event.assignmentSaved") || "✅ Atribuição com viagem guardada!");
    carregarAtribuicoesNaUI(semanaId);

  } catch (err) {
    console.error("❌ Erro ao gravar atribuição:", err);
    alert((t(currentLang, "event.assignError") || "Erro ao atribuir") + ": " + err.message);
  }
};

onAuthStateChanged(auth, async (user) => {
  if (!user) return alert(t(currentLang, "auth.loginRequired") || "Login necessário.");
  currentLang = await initUserLanguage(user.uid);
  const langSelect = document.getElementById("langSelect");
  bindLanguageSelector(langSelect, user.uid, currentLang);
  if (langSelect) {
    langSelect.addEventListener("change", async () => {
      currentLang = localStorage.getItem("appLang") || langSelect.value;
      await carregarEvento();
    });
  }
  await carregarEvento();
  await carregarUsuarios();
});

async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "users"));
  snap.forEach(doc => {
    const user = doc.data();
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = user.nome || user.email || doc.id;
    userSelect.appendChild(opt);
  });
}

salvarBtn.onclick = async () => {
  const nome = eventoNome.value.trim();
  const data = eventoData.value;
  const local = eventoLocal.value.trim();

  if (!nome || !data || !local) {
    alert(t(currentLang, "event.fillAll") || "Preencha todos os campos!");
    return;
  }

  const semanaId = getSemanaIdFromEventoId(eventoId);
  const eventoRef = doc(db, `eventos/${semanaId}/lista/${eventoId}`);

  await setDoc(eventoRef, {
    nome,
    data,
    local
  }, { merge: true });

  alert(t(currentLang, "event.updated") || "Dados do evento atualizados!");
};

function editarViagem(userId, viagem) {
  document.getElementById("modalUserId").value = userId;

  document.getElementById("editIdaData").value = viagem?.ida?.data || "";
  document.getElementById("editIdaHora").value = viagem?.ida?.hora || "";
  document.getElementById("editIdaPartida").value = viagem?.ida?.partida || "";
  document.getElementById("editIdaChegada").value = viagem?.ida?.chegada || "";
  document.getElementById("editIdaTransporte").value = viagem?.ida?.transporte || "carro";

  document.getElementById("editVoltaData").value = viagem?.volta?.data || "";
  document.getElementById("editVoltaHora").value = viagem?.volta?.hora || "";
  document.getElementById("editVoltaPartida").value = viagem?.volta?.partida || "";
  document.getElementById("editVoltaChegada").value = viagem?.volta?.chegada || "";
  document.getElementById("editVoltaTransporte").value = viagem?.volta?.transporte || "carro";

  document.getElementById("viagemModal").style.display = "block";
}

function fecharModal() {
  document.getElementById("viagemModal").style.display = "none";
}

async function salvarViagemEditada() {
  const userId = document.getElementById("modalUserId").value;
  const semanaId = getSemanaIdFromEventoId(eventoId);

  const viagem = {
    ida: {
      data: document.getElementById("editIdaData").value,
      hora: document.getElementById("editIdaHora").value,
      partida: document.getElementById("editIdaPartida").value,
      chegada: document.getElementById("editIdaChegada").value,
      transporte: document.getElementById("editIdaTransporte").value,
    },
    volta: {
      data: document.getElementById("editVoltaData").value,
      hora: document.getElementById("editVoltaHora").value,
      partida: document.getElementById("editVoltaPartida").value,
      chegada: document.getElementById("editVoltaChegada").value,
      transporte: document.getElementById("editVoltaTransporte").value,
    }
  };

  try {
    await setDoc(doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${userId}`), {
      viagem
    }, { merge: true });

    alert(t(currentLang, "event.travelUpdated") || "🚀 Viagem atualizada com sucesso!");
    fecharModal();
    carregarAtribuicoesNaUI(semanaId);
  } catch (err) {
    alert((t(currentLang, "event.travelSaveError") || "❌ Erro ao salvar viagem") + ": " + err.message);
  }
}
let eventoNome = document.getElementById("eventoNome");
});
