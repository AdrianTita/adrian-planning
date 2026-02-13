// auth.js
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { t } from "./i18n.js";

window.addEventListener("DOMContentLoaded", () => {
  const currentLang = localStorage.getItem("appLang") || "en";
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const senha = document.getElementById("password").value;
    

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      await registrarUserSeNaoExiste(user); // Novo passo

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        alert(t(currentLang, "login.userNotFound") || "Usuário não encontrado na base de dados.");
        return;
      }

      const userData = userSnap.data();
const role = userData.role;

// Armazena o role para uso no dashboard
localStorage.setItem("userRole", role);

if (role === "admin") {
  window.location.href = "dashboard.html";
} else if (role === "user") {
  window.location.href = "dashboard.html";
} else {
  alert(t(currentLang, "login.roleUnknown") || "Papel de utilizador desconhecido.");
}

    } catch (error) {
      alert((t(currentLang, "login.error") || "Erro no login") + ": " + error.message);
    }
  });
});

async function registrarUserSeNaoExiste(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || "",
      role: "user"
    });
  }
}
