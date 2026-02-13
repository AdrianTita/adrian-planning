import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, getDocs, updateDoc, collection
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { initUserLanguage, bindLanguageSelector, t } from "./i18n.js";

window.addEventListener("DOMContentLoaded", function () {
  const atribuicoesDiv = document.getElementById("atribuicoesContainer");
  let currentLang = localStorage.getItem("appLang") || "en";

  onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = "index.html";
    currentLang = await initUserLanguage(user.uid);
    const langSelect = document.getElementById("langSelect");
    bindLanguageSelector(langSelect, user.uid, currentLang);
    if (langSelect) {
      langSelect.addEventListener("change", () => {
        currentLang = localStorage.getItem("appLang") || langSelect.value;
        listarConvitesDoTrabalhador(user.uid);
      });
    }
    await listarConvitesDoTrabalhador(user.uid);
  });

  async function listarConvitesDoTrabalhador(userId) {
    atribuicoesDiv.innerHTML = "";

    const semanasSnap = await getDocs(collection(db, "eventos"));

    for (const semanaDoc of semanasSnap.docs) {
      const semanaId = semanaDoc.id;
      const eventosSnap = await getDocs(collection(db, `eventos/${semanaId}/lista`));

      for (const eventoDoc of eventosSnap.docs) {
        const evento = eventoDoc.data();
        const eventoId = eventoDoc.id;

        const atribuicaoRef = doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${userId}`);
        const atribuicaoSnap = await getDoc(atribuicaoRef);

        if (!atribuicaoSnap.exists()) continue;

        const dados = atribuicaoSnap.data();
        const div = document.createElement("div");
        div.className = "evento-box";
        div.innerHTML = `
          <strong>${evento.nome}</strong><br>
          ${evento.data} - ${evento.local}<br>
          <strong>${t(currentLang, "eventUser.role") || "Função"}:</strong> ${dados.funcao}<br>
          <strong>${t(currentLang, "eventUser.status") || "Status"}:</strong> <span style="color: ${statusColor(dados.status)}">${t(currentLang, `status.${dados.status}`) || dados.status}</span><br>
        `;

        if (dados.status === "pendente") {
          const btnAceitar = document.createElement("button");
          btnAceitar.textContent = `✅ ${t(currentLang, "eventUser.accept") || "Aceitar"}`;
          btnAceitar.onclick = async () => {
            await updateDoc(atribuicaoRef, { status: "aceite" });
            alert(t(currentLang, "eventUser.accepted") || "Convite aceite!");
            listarConvitesDoTrabalhador(userId);
          };

          const btnRejeitar = document.createElement("button");
          btnRejeitar.textContent = `❌ ${t(currentLang, "eventUser.reject") || "Rejeitar"}`;
          btnRejeitar.style.marginLeft = "10px";
          btnRejeitar.onclick = async () => {
            await updateDoc(atribuicaoRef, { status: "rejeitado" });
            alert(t(currentLang, "eventUser.rejected") || "Convite rejeitado.");
            listarConvitesDoTrabalhador(userId);
          };

          div.appendChild(btnAceitar);
          div.appendChild(btnRejeitar);
        }

        atribuicoesDiv.appendChild(div);
      }
    }
  }

  function statusColor(status) {
    if (status === "aceite") return "green";
    if (status === "rejeitado") return "red";
    return "orange";
  }
});
