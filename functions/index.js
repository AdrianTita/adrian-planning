/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {onInit} = require("firebase-functions/v2/core");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {Resend} = require("resend");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM = defineSecret("RESEND_FROM");

let resend = null;
let FROM_EMAIL = "";
onInit(() => {
  resend = new Resend(RESEND_API_KEY.value());
  FROM_EMAIL = RESEND_FROM.value();
});

async function assertAdmin(context) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }
  const snap = await db.collection("users").doc(context.auth.uid).get();
  const role = snap.exists ? (snap.data().role || "user") : "user";
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

async function sendEmail({to, subject, html}) {
  if (!resend || !FROM_EMAIL) {
    throw new HttpsError("failed-precondition", "Missing RESEND_API_KEY or RESEND_FROM.");
  }
  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
}

const TEMPLATES = {
  en: {
    planningSubject: "Invitation to Planning",
    planningBody: (name, link) => `
      <p>Hello${name ? ` ${name}` : ""},</p>
      <p>Your access to the Adrian Events planning has been created.</p>
      <p>Please set your password using this link:</p>
      <p><a href="${link}">Set password</a></p>
    `,
    resetSubject: "Password reset",
    resetBody: (link) => `
      <p>We received a request to reset your password.</p>
      <p>If it was you, use the link below:</p>
      <p><a href="${link}">Reset password</a></p>
    `,
    assignmentSubject: "Event invitation",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Hello${name ? ` ${name}` : ""},</p>
      <p>You have been invited to the event <strong>${eventName}</strong> as <strong>${roleName}</strong>.</p>
      ${dateStr ? `<p>Date: ${dateStr}</p>` : ""}
      <p>Please reply within <strong>${deadlineDays} business days</strong>.</p>
      ${link ? `<p><a href="${link}">Open planning</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Weekly Request for you for W ${weekNum}`,
    weekEventsLabel: "Planned events",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Hello "${name || "x"}",</p>
      <p>We have planned you in our pre-planning for the following week:</p>
      <p><strong>Employee</strong> "${name || "x"}"<br>
      <strong>Calendar week</strong> ${weekNum}<br>
      ${dateStr ? `<strong>Date</strong> ${dateStr}<br>` : ""}
      <strong>Entered by</strong> "${adminName || "admin name"}"</p>
      ${eventsHtml || ""}
      <p>Are you available this week? Please go to the Internal System to confirm or cancel the weekly request within the next ${deadlineDays} days.</p>
      <p>If you do not respond, we will consider this as a cancellation and will have to reschedule.</p>
      <p>If you have any questions or difficulties, please do not hesitate to contact us. Just contact "${adminName || "admin"}".</p>
      <p>Best wishes and stay healthy!</p>
    `,
    statusSubject: "Invitation response",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Status update:</p>
      <p><strong>${userName || "User"}</strong> ${status} the role <strong>${roleName}</strong> in <strong>${eventName}</strong>.</p>
    `
  },
  pt: {
    planningSubject: "Convite para o planeamento",
    planningBody: (name, link) => `
      <p>Olá${name ? ` ${name}` : ""},</p>
      <p>Foi criado o teu acesso ao planeamento da Adrian Events.</p>
      <p>Para definires a tua palavra‑passe, usa este link:</p>
      <p><a href="${link}">Definir palavra‑passe</a></p>
    `,
    resetSubject: "Reset de password",
    resetBody: (link) => `
      <p>Recebemos um pedido para redefinir a tua palavra‑passe.</p>
      <p>Se foste tu, usa o link abaixo:</p>
      <p><a href="${link}">Redefinir palavra‑passe</a></p>
    `,
    assignmentSubject: "Convite para evento",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Olá${name ? ` ${name}` : ""},</p>
      <p>Foste convidado para o evento <strong>${eventName}</strong> na função <strong>${roleName}</strong>.</p>
      ${dateStr ? `<p>Datas: ${dateStr}</p>` : ""}
      <p>Por favor responde no prazo de <strong>${deadlineDays} dias úteis</strong>.</p>
      ${link ? `<p><a href="${link}">Abrir planeamento</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Pedido semanal para W ${weekNum}`,
    weekEventsLabel: "Eventos planeados",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Olá ${name || ""},</p>
      <p>Foste pré‑planeado para a seguinte semana:</p>
      <p><strong>Semana</strong> ${weekNum}<br>${dateStr ? `<strong>Data</strong> ${dateStr}<br>` : ""}<strong>Inserido por</strong> ${adminName || "-"}</p>
      ${eventsHtml || ""}
      <p>Estás disponível esta semana? Por favor confirma ou recusa no sistema interno no prazo de ${deadlineDays} dias.</p>
      <p>Se não responderes, vamos considerar como recusa.</p>
      <p>Em caso de dúvidas, contacta ${adminName || "admin"}.</p>
      <p>Obrigado!</p>
    `,
    statusSubject: "Resposta ao convite",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Atualização de estado:</p>
      <p><strong>${userName || "Utilizador"}</strong> ${status} a função <strong>${roleName}</strong> no evento <strong>${eventName}</strong>.</p>
    `
  },
  de: {
    planningSubject: "Einladung zur Planung",
    planningBody: (name, link) => `
      <p>Hallo${name ? ` ${name}` : ""},</p>
      <p>Dein Zugang zur Adrian Events Planung wurde erstellt.</p>
      <p>Bitte setze dein Passwort über diesen Link:</p>
      <p><a href="${link}">Passwort setzen</a></p>
    `,
    resetSubject: "Passwort zurücksetzen",
    resetBody: (link) => `
      <p>Wir haben eine Anfrage zum Zurücksetzen deines Passworts erhalten.</p>
      <p>Wenn du es warst, nutze den Link:</p>
      <p><a href="${link}">Passwort zurücksetzen</a></p>
    `,
    assignmentSubject: "Einladung zum Event",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Hallo${name ? ` ${name}` : ""},</p>
      <p>Du wurdest für das Event <strong>${eventName}</strong> als <strong>${roleName}</strong> eingeladen.</p>
      ${dateStr ? `<p>Datum: ${dateStr}</p>` : ""}
      <p>Bitte antworte innerhalb von <strong>${deadlineDays} Arbeitstagen</strong>.</p>
      ${link ? `<p><a href="${link}">Planung öffnen</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Wöchentliche Anfrage für KW ${weekNum}`,
    weekEventsLabel: "Geplante Events",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Hallo ${name || ""},</p>
      <p>Du wurdest für die folgende Woche vorgemerkt:</p>
      <p><strong>Kalenderwoche</strong> ${weekNum}<br>${dateStr ? `<strong>Datum</strong> ${dateStr}<br>` : ""}<strong>Eingetragen von</strong> ${adminName || "-"}</p>
      ${eventsHtml || ""}
      <p>Bist du diese Woche verfügbar? Bitte bestätige oder lehne innerhalb von ${deadlineDays} Tagen ab.</p>
      <p>Ohne Antwort werten wir dies als Ablehnung.</p>
      <p>Bei Fragen kontaktiere ${adminName || "Admin"}.</p>
      <p>Viele Grüße!</p>
    `,
    statusSubject: "Antwort auf Einladung",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Status‑Update:</p>
      <p><strong>${userName || "Benutzer"}</strong> hat ${status} für <strong>${roleName}</strong> im Event <strong>${eventName}</strong>.</p>
    `
  },
  ro: {
    planningSubject: "Invitație la planificare",
    planningBody: (name, link) => `
      <p>Bună${name ? ` ${name}` : ""},</p>
      <p>Accesul tău la planificarea Adrian Events a fost creat.</p>
      <p>Setează parola aici:</p>
      <p><a href="${link}">Setează parola</a></p>
    `,
    resetSubject: "Resetare parolă",
    resetBody: (link) => `
      <p>Am primit o cerere de resetare a parolei.</p>
      <p>Dacă ai cerut tu, folosește linkul:</p>
      <p><a href="${link}">Resetează parola</a></p>
    `,
    assignmentSubject: "Invitație la eveniment",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Bună${name ? ` ${name}` : ""},</p>
      <p>Ai fost invitat la evenimentul <strong>${eventName}</strong> ca <strong>${roleName}</strong>.</p>
      ${dateStr ? `<p>Data: ${dateStr}</p>` : ""}
      <p>Te rugăm să răspunzi în <strong>${deadlineDays} zile lucrătoare</strong>.</p>
      ${link ? `<p><a href="${link}">Deschide planificarea</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Cerere săptămânală pentru S ${weekNum}`,
    weekEventsLabel: "Evenimente planificate",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Bună ${name || ""},</p>
      <p>Ai fost pre‑planificat pentru săptămâna următoare:</p>
      <p><strong>Săptămâna</strong> ${weekNum}<br>${dateStr ? `<strong>Data</strong> ${dateStr}<br>` : ""}<strong>Introdus de</strong> ${adminName || "-"}</p>
      ${eventsHtml || ""}
      <p>Confirmă sau respinge în ${deadlineDays} zile.</p>
      <p>Dacă nu răspunzi, vom considera refuz.</p>
      <p>Pentru întrebări, contactează ${adminName || "admin"}.</p>
    `,
    statusSubject: "Răspuns invitație",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Actualizare status:</p>
      <p><strong>${userName || "Utilizator"}</strong> a ${status} rolul <strong>${roleName}</strong> în <strong>${eventName}</strong>.</p>
    `
  },
  fr: {
    planningSubject: "Invitation à la planification",
    planningBody: (name, link) => `
      <p>Bonjour${name ? ` ${name}` : ""},</p>
      <p>Votre accès à la planification Adrian Events a été créé.</p>
      <p>Définissez votre mot de passe ici :</p>
      <p><a href="${link}">Définir le mot de passe</a></p>
    `,
    resetSubject: "Réinitialisation du mot de passe",
    resetBody: (link) => `
      <p>Nous avons reçu une demande de réinitialisation du mot de passe.</p>
      <p>Si c'était vous, utilisez le lien :</p>
      <p><a href="${link}">Réinitialiser le mot de passe</a></p>
    `,
    assignmentSubject: "Invitation à l'événement",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Bonjour${name ? ` ${name}` : ""},</p>
      <p>Vous êtes invité à l'événement <strong>${eventName}</strong> comme <strong>${roleName}</strong>.</p>
      ${dateStr ? `<p>Date : ${dateStr}</p>` : ""}
      <p>Merci de répondre sous <strong>${deadlineDays} jours ouvrés</strong>.</p>
      ${link ? `<p><a href="${link}">Ouvrir la planification</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Demande hebdomadaire pour S ${weekNum}`,
    weekEventsLabel: "Événements planifiés",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Bonjour ${name || ""},</p>
      <p>Vous avez été pré‑planifié pour la semaine suivante :</p>
      <p><strong>Semaine</strong> ${weekNum}<br>${dateStr ? `<strong>Date</strong> ${dateStr}<br>` : ""}<strong>Inséré par</strong> ${adminName || "-"}</p>
      ${eventsHtml || ""}
      <p>Merci de confirmer ou refuser sous ${deadlineDays} jours.</p>
      <p>Sans réponse, nous considérerons un refus.</p>
      <p>Contactez ${adminName || "admin"} en cas de questions.</p>
    `,
    statusSubject: "Réponse à l'invitation",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Statut :</p>
      <p><strong>${userName || "Utilisateur"}</strong> a ${status} le rôle <strong>${roleName}</strong> pour <strong>${eventName}</strong>.</p>
    `
  },
  es: {
    planningSubject: "Invitación a la planificación",
    planningBody: (name, link) => `
      <p>Hola${name ? ` ${name}` : ""},</p>
      <p>Tu acceso a la planificación de Adrian Events ha sido creado.</p>
      <p>Define tu contraseña aquí:</p>
      <p><a href="${link}">Definir contraseña</a></p>
    `,
    resetSubject: "Restablecer contraseña",
    resetBody: (link) => `
      <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
      <p>Si fuiste tú, usa el enlace:</p>
      <p><a href="${link}">Restablecer contraseña</a></p>
    `,
    assignmentSubject: "Invitación al evento",
    assignmentBody: (name, eventName, roleName, dateStr, deadlineDays, link) => `
      <p>Hola${name ? ` ${name}` : ""},</p>
      <p>Has sido invitado al evento <strong>${eventName}</strong> como <strong>${roleName}</strong>.</p>
      ${dateStr ? `<p>Fecha: ${dateStr}</p>` : ""}
      <p>Responde en <strong>${deadlineDays} días hábiles</strong>.</p>
      ${link ? `<p><a href="${link}">Abrir planificación</a></p>` : ""}
    `,
    weekSubject: (weekNum) => `Solicitud semanal para S ${weekNum}`,
    weekEventsLabel: "Eventos planificados",
    weekBody: (name, weekNum, dateStr, adminName, eventsHtml, deadlineDays) => `
      <p>Hola ${name || ""},</p>
      <p>Has sido pre‑planificado para la siguiente semana:</p>
      <p><strong>Semana</strong> ${weekNum}<br>${dateStr ? `<strong>Fecha</strong> ${dateStr}<br>` : ""}<strong>Registrado por</strong> ${adminName || "-"}</p>
      ${eventsHtml || ""}
      <p>Confirma o rechaza en ${deadlineDays} días.</p>
      <p>Si no respondes, lo consideraremos como rechazo.</p>
      <p>Si tienes dudas, contacta a ${adminName || "admin"}.</p>
    `,
    statusSubject: "Respuesta a la invitación",
    statusBody: (userName, eventName, roleName, status) => `
      <p>Actualización de estado:</p>
      <p><strong>${userName || "Usuario"}</strong> ${status} el rol <strong>${roleName}</strong> en <strong>${eventName}</strong>.</p>
    `
  },
};

function pickLang(lang) {
  const l = (lang || "en").toLowerCase();
  return TEMPLATES[l] ? l : "en";
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

exports.sendPlanningInvite = onCall({region: "europe-west1", secrets: [RESEND_API_KEY, RESEND_FROM]}, async (request) => {
  await assertAdmin(request);
  const {email, name, continueUrl, uid, language} = request.data || {};
  if (!email) throw new HttpsError("invalid-argument", "Email required.");

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    user = await admin.auth().createUser({email});
  }

  let lang = language || "en";
  if (uid) {
    const uSnap = await db.collection("users").doc(uid).get();
    if (uSnap.exists && uSnap.data().language) lang = uSnap.data().language;
  }
  lang = pickLang(lang);

  const actionSettings = continueUrl ? {url: continueUrl, handleCodeInApp: false} : undefined;
  const resetLink = await admin.auth().generatePasswordResetLink(email, actionSettings);
  const tpl = TEMPLATES[lang];
  const html = tpl.planningBody(name, resetLink);
  await sendEmail({
    to: email,
    subject: tpl.planningSubject,
    html,
  });

  return {ok: true, uid: user.uid};
});

exports.sendResetPassword = onCall({region: "europe-west1", secrets: [RESEND_API_KEY, RESEND_FROM]}, async (request) => {
  await assertAdmin(request);
  const {email, continueUrl, language} = request.data || {};
  if (!email) throw new HttpsError("invalid-argument", "Email required.");
  const lang = pickLang(language);
  const actionSettings = continueUrl ? {url: continueUrl, handleCodeInApp: false} : undefined;
  const resetLink = await admin.auth().generatePasswordResetLink(email, actionSettings);
  const tpl = TEMPLATES[lang];
  const html = tpl.resetBody(resetLink);
  await sendEmail({
    to: email,
    subject: tpl.resetSubject,
    html,
  });
  return {ok: true};
});

exports.sendAssignmentInvite = onCall({region: "europe-west1", secrets: [RESEND_API_KEY, RESEND_FROM]}, async (request) => {
  await assertAdmin(request);
  const {email, userName, eventName, roleName, startDate, endDate, deadlineDays = 5, eventLink, language} = request.data || {};
  if (!email || !eventName || !roleName) throw new HttpsError("invalid-argument", "Missing fields.");
  const dateStr = startDate ? `${formatDate(startDate)}${endDate ? " → " + formatDate(endDate) : ""}` : "";
  const lang = pickLang(language);
  const tpl = TEMPLATES[lang];
  const html = tpl.assignmentBody(userName, eventName, roleName, dateStr, deadlineDays, eventLink);
  await sendEmail({
    to: email,
    subject: tpl.assignmentSubject,
    html,
  });
  return {ok: true};
});

exports.sendWeekInvite = onCall({region: "europe-west1", secrets: [RESEND_API_KEY, RESEND_FROM]}, async (request) => {
  await assertAdmin(request);
  const {email, userName, adminName, weekNumber, startDate, endDate, events = [], language, deadlineDays = 5} = request.data || {};
  if (!email || !weekNumber) throw new HttpsError("invalid-argument", "Missing fields.");
  const lang = pickLang(language);
  const tpl = TEMPLATES[lang];
  const dateStr = startDate ? `${formatDate(startDate)}${endDate ? " - " + formatDate(endDate) : ""}` : "";
  const eventsHtml = events.length ? `
    <p><strong>${tpl.weekEventsLabel}</strong></p>
    <ul>
      ${events.map(e => `<li>${e.nome || "Event"}${e.funcoes?.length ? ` — ${e.funcoes.join(", ")}` : ""}</li>`).join("")}
    </ul>
  ` : "";
  const html = tpl.weekBody(userName, weekNumber, dateStr, adminName, eventsHtml, deadlineDays);
  await sendEmail({
    to: email,
    subject: tpl.weekSubject(weekNumber),
    html,
  });
  return {ok: true};
});

exports.notifyAssignmentStatus = onCall({region: "europe-west1", secrets: [RESEND_API_KEY, RESEND_FROM]}, async (request) => {
  const {userName, userEmail, eventName, roleName, status, language} = request.data || {};
  if (!eventName || !roleName || !status) throw new HttpsError("invalid-argument", "Missing fields.");

  const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
  const adminEmails = [];
  adminsSnap.forEach((d) => {
    const u = d.data() || {};
    if (u.email) adminEmails.push(u.email);
  });
  if (!adminEmails.length) return {ok: true, skipped: true};

  const lang = pickLang(language);
  const tpl = TEMPLATES[lang];
  const html = tpl.statusBody(userName || userEmail, eventName, roleName, status);
  await sendEmail({
    to: adminEmails,
    subject: tpl.statusSubject,
    html,
  });
  return {ok: true};
});

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
