import { db } from "./firebase-config.js";
import {
  collection, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

async function atualizarEstruturaAtribuicoes(semanaId) {
  const eventosSnap = await getDocs(collection(db, `eventos/${semanaId}/lista`));

  for (const eventoDoc of eventosSnap.docs) {
    const eventoId = eventoDoc.id;
    const atribuicoesRef = collection(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes`);
    const atribuicoesSnap = await getDocs(atribuicoesRef);

    for (const atribuicaoDoc of atribuicoesSnap.docs) {
      const uid = atribuicaoDoc.id;
      const data = atribuicaoDoc.data();
      const patch = {};

      if (!data.status) patch.status = "pendente";
      if (!data.instrucao) patch.instrucao = "";
      if (!data.transporte) {
        patch.transporte = {
          tipo: "",
          ida: { data: "", hora: "", partida: "", chegada: "" },
          volta: { data: "", hora: "", partida: "", chegada: "" }
        };
      }

      if (Object.keys(patch).length > 0) {
        const ref = doc(db, `eventos/${semanaId}/lista/${eventoId}/atribuicoes/${uid}`);
        await updateDoc(ref, patch);
        console.log(`Atualizado: ${eventoId} / ${uid}`);
      }
    }
  }

  alert("Estrutura atualizada para todas as atribuições da semana.");
}
