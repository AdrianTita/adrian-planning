
import { db } from "./firebase-config.js";
import {
    collection, getDocs, updateDoc, doc, setDoc, deleteDoc
  } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
    // ⚠️ ATENÇÃO: isto troca a sessão atual para o novo utilizador. Idealmente usar Cloud Function/Admin SDK.
createUserWithEmailAndPassword
  } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getDoc, doc as docX } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";

let currentLang = localStorage.getItem("appLang") || "en";
const getLang = () => currentLang || localStorage.getItem("appLang") || "en";
const tr = (key, fallback) => t(getLang(), key) || fallback;

// 🔐 Só admins podem aceder
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "index.html";
  const snap = await getDoc(docX(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    alert(tr("alert.adminOnly", "Acesso restrito ao administrador."));
    window.location.href = "dashboard.html";
    return;
  }
  currentLang = await initUserLanguage(user.uid, snap.data(), snap.exists());
  bindLanguageSelector(document.getElementById("langSelect"), user.uid, currentLang);
});

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("criarUserForm").addEventListener("submit", async (e) => {
        e.preventDefault();
      
        const email = document.getElementById("novoEmail").value;
        const password = document.getElementById("novaPassword").value;
        const role = document.getElementById("novoRole").value;
        
      
        try {
          // Cria o utilizador no Auth
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const uid = cred.user.uid;
      
          // Regista na coleção users
          await setDoc(doc(db, "users", uid), {
            email,
            role,
            displayName: ""
          });
      
          alert(tr("adminUsers.createdOk", "Utilizador criado com sucesso!"));
          window.location.reload();
      
        } catch (err) {
          alert(tr("adminUsers.createError", "Erro ao criar utilizador: ") + err.message);
        }
      });
  const tableBody = document.getElementById("userTableBody");

  const querySnapshot = await getDocs(collection(db, "users"));
  querySnapshot.forEach(docSnap => {
    const user = docSnap.data();
    const uid = docSnap.id;

    const tr = document.createElement("tr");

    const tdEmail = document.createElement("td");
    tdEmail.textContent = user.email;

    const tdName = document.createElement("td");
    tdName.textContent = user.displayName || "-";

    const tdRole = document.createElement("td");
    const select = document.createElement("select");
    ["user", "admin"].forEach(role => {
      const opt = document.createElement("option");
      opt.value = role;
      opt.text = tr(`role.${role}`, role);
      if (user.role === role) opt.selected = true;
      select.appendChild(opt);
    });
    tdRole.appendChild(select);

    const tdAction = document.createElement("td");

// Botão para atualizar role
const btnSalvar = document.createElement("button");
btnSalvar.textContent = tr("common.save", "Salvar");
btnSalvar.onclick = async () => {
  const novoRole = select.value;
  await updateDoc(doc(db, "users", uid), { role: novoRole });
  alert(tr("adminUsers.roleUpdatedPrefix", "Role atualizado para: ") + novoRole);
};

// Botão para apagar
const btnRemover = document.createElement("button");
btnRemover.textContent = tr("common.delete", "Remover");
btnRemover.style.marginLeft = "10px";
btnRemover.onclick = async () => {
  if (!confirm(tr("adminUsers.confirmDelete", "Tens a certeza que queres remover este utilizador?"))) return;
  try {
    await deleteDoc(doc(db, "users", uid));
    alert(tr("adminUsers.deletedOk", "Utilizador removido da base de dados (Firestore)."));

    // ⚠️ Isso não remove do Firebase Auth
    window.location.reload();
  } catch (err) {
    alert(tr("adminUsers.deleteError", "Erro ao remover utilizador: ") + err.message);
  }
};

tdAction.appendChild(btnSalvar);
tdAction.appendChild(btnRemover);

    tr.append(tdEmail, tdName, tdRole, tdAction);
    tableBody.appendChild(tr);
  });
});
