
/// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBf4wlodXW5_qX7n49EKrugTA9yZlRU2OY",
  authDomain: "planning-adrian-ptk.firebaseapp.com",
  projectId: "planning-adrian-ptk",
  storageBucket: "planning-adrian-ptk.appspot.com",
  messagingSenderId: "93454362993",
  appId: "1:93454362993:web:53227702de54284b832ed0",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
