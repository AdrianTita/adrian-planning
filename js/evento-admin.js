import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, addDoc, setDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";
window.addEventListener("DOMContentLoaded", function() {
listarEventos();
const nomeInput = document.getElementById("nomeEvento");
const dataInput = document.getElementById("dataEvento");
const localInput = document.getElementById("localEvento");
const guardarBtn = document.getElementById("guardarEvento");
const funcoesContainer = document.getElementById("funcoes");
const userSelect = document.getElementById("userSelect");
const funcaoSelect = document.getElementById("funcaoSelect");
const atribuirBtn = document.getElementById("atribuirBtn");
const eventosCriados = document.getElementById("eventosCriados");
const funcoes = [];
const inputFuncao = document.getElementById("novaFuncao");
const btnAddFuncao = document.getElementById("adicionarFuncao");
const listaFuncoes = document.getElementById("listaFuncoes");

let eventoIdGlobal = "";
let semanaIdGlobal = "";
let currentLang = localStorage.getItem("appLang") || "en";


onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "index.html"; // redireciona se não autenticado

  const snap = await getDoc(doc(db, "users", user.uid));
  const data = snap.data();

  if (data?.role !== "admin") {
    alert(t(currentLang, "eventAdmin.adminOnly") || "Acesso restrito ao administrador.");
    window.location.href = "dashboard.html";
  }

  currentLang = await initUserLanguage(user.uid, data, snap.exists());
  const langSelect = document.getElementById("langSelect");
  bindLanguageSelector(langSelect, user.uid, currentLang);
  if (langSelect) {
    langSelect.addEventListener("change", () => {
      currentLang = localStorage.getItem("appLang") || langSelect.value;
      listarEventos();
    });
  }
});

btnAddFuncao.onclick = () => {
  const nova = inputFuncao.value.trim();
  if (nova && !funcoes.includes(nova)) {
    funcoes.push(nova);
    const li = document.createElement("li");
    li.textContent = nova;
    listaFuncoes.appendChild(li);
    inputFuncao.value = "";
  }
};

// Criação do evento
guardarBtn.onclick = async () => {
  const nome = nomeInput.value;
  const data = dataInput.value;
  const local = localInput.value;

  if (!nome || !data || !local) return alert(t(currentLang, "eventAdmin.alertFillAll") || "Preencha todos os campos!");

  const semanaId = getSemanaISO(new Date(data));
  semanaIdGlobal = semanaId;

  const eventoRef = await addDoc(collection(db, `eventos/${semanaId}/lista`), {
    nome,
    data,
    local,
    funcoesDisponiveis: funcoes
  });
  eventoIdGlobal = eventoRef.id;
  alert(t(currentLang, "eventAdmin.alertCreated") || "Evento criado com sucesso!");
  window.location.href = `evento.html?id=${eventoIdGlobal}`;
  listarEventos();
};

// Preenche dropdown com usuários
async function carregarUsuarios() {
  const usersSnap = await getDocs(collection(db, "users"));
  usersSnap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.text = doc.data().nome || doc.data().email;
    userSelect.appendChild(opt);
  });
}

// Atribuir função
atribuirBtn.onclick = async () => {
  const userId = userSelect.value;
  const funcao = funcaoSelect.value;

  if (!eventoIdGlobal || !semanaIdGlobal) return alert(t(currentLang, "eventAdmin.alertCreateFirst") || "Crie um evento primeiro");

  const atribuicao = {
    funcao,
    status: "pendente",
    nota: "",
    viagem: {
      ida: { meio: "", local: "", dataHora: "" },
      volta: { meio: "", local: "", dataHora: "" }
    }
  };

  try {
    await setDoc(doc(db, `eventos/${semanaIdGlobal}/lista/${eventoIdGlobal}/atribuicoes/${userId}`), atribuicao);
  } catch (error) {
    console.error("Erro ao atribuir no Firebase:", error);
  }

  try {
    await setDoc(doc(db, `eventos/${semanaIdGlobal}/lista/${eventoIdGlobal}/atribuicoes/${userId}`), atribuicao);
  } catch (error) {
    console.error("Erro ao atribuir no Firebase:", error);
  }
  try {
    await setDoc(
      doc(db, `users/${userId}/historicoAtribuicoes/${eventoIdGlobal}`),
      {
        nome: atribuicao.nome,
        data: atribuicao.data,
        local: atribuicao.local,
        funcao: atribuicao.funcao,
        status: atribuicao.status
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Erro ao guardar histórico de atribuição do utilizador:", error);
  }

  alert(t(currentLang, "eventAdmin.alertAssigned") || "Atribuição feita!");
};

// Mostrar eventos existentes
async function listarEventos() {
  eventosCriados.innerHTML = "";
  const semanasSnap = await getDocs(collection(db, "eventos"));

  for (const semanaDoc of semanasSnap.docs) {
    const semanaId = semanaDoc.id;
    const listaSnap = await getDocs(collection(db, `eventos/${semanaId}/lista`));

    listaSnap.forEach(doc => {
      const ev = doc.data();
      const div = document.createElement("div");
      div.className = "evento-box";
      div.innerHTML = `<strong>${ev.nome}</strong><br>${ev.data} - ${ev.local}`;

      // Criar botão editar para este evento
      const btnEditar = document.createElement("button");
      btnEditar.textContent = `✏️ ${t(currentLang, "common.edit") || "Editar"}`;
      btnEditar.onclick = () => {
        window.location.href = `evento.html?id=${doc.id}&semana=${semanaId}`;
      };
      div.appendChild(btnEditar);

      eventosCriados.appendChild(div);
    });
  }
}

// Cálculo ISO da semana
function getSemanaISO(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return String(1 + Math.ceil((firstThursday - target) / 604800000));
}

// Auth listener para carregar usuários
onAuthStateChanged(auth, async user => {
  if (user) {
    await carregarUsuarios();
    await listarEventos();
  }
});
});
