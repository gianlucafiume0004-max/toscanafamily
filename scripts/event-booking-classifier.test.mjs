import test from "node:test";
import assert from "node:assert/strict";
import { classifyBookingText } from "./event-booking-classifier.mjs";

test("classifies explicit mandatory reservation, registration, and sign-up", () => {
  for (const text of [
    "Prenotazione obbligatoria per partecipare.",
    "Prenotazione richiesta.",
    "Prenotazione online obbligatoria per i partecipanti.",
    "È obbligatorio prenotare.",
    "Per partecipare è obbligatorio prenotare.",
    "È richiesta la prenotazione.",
    "Partecipazione previa prenotazione.",
    "Iscrizione obbligatoria entro venerdì.",
    "La registrazione è obbligatoria."
  ]) {
    const result = classifyBookingText(text);
    assert.equal(result.status, "required", text);
    assert.equal(result.booking_required, true, text);
  }
});

test("classifies an explicitly recommended reservation as not mandatory", () => {
  for (const text of [
    "La prenotazione è consigliata.",
    "Si consiglia la prenotazione.",
    "Prenotazione raccomandata."
  ]) {
    const result = classifyBookingText(text);
    assert.equal(result.status, "recommended", text);
    assert.equal(result.booking_required, false, text);
    assert.ok(result.booking_notes, text);
  }
});

test("classifies explicit no-reservation statements", () => {
  for (const text of [
    "Non è necessaria la prenotazione.",
    "Senza prenotazione.",
    "Non occorre prenotare.",
    "Partecipazione senza prenotazione."
  ]) {
    const result = classifyBookingText(text);
    assert.equal(result.status, "not_required", text);
    assert.equal(result.booking_required, false, text);
  }
});

test("classifies free admission and free events", () => {
  for (const text of [
    "Ingresso gratuito.",
    "Accesso gratuito.",
    "Partecipazione gratuita.",
    "Evento gratuito.",
    "Attività gratuita.",
    "Laboratorio gratuito.",
    "Ingresso libero.",
    "Accesso libero.",
    "Evento ad accesso libero.",
    "Partecipazione libera.",
    "Ingresso libero fino a esaurimento posti."
  ]) {
    const result = classifyBookingText(text);
    assert.equal(result.status, "free", text);
    assert.equal(result.booking_required, false, text);
  }
});

test("does not infer mandatory reservation from limited places alone", () => {
  const result = classifyBookingText("Posti limitati.");
  assert.equal(result.status, "unclassified");
  assert.equal(result.booking_required, null);
  assert.match(result.booking_notes, /posti limitati/i);
});

test("keeps Unicode evidence excerpts well-formed", () => {
  const text = `${"x".repeat(68)}📍${"x".repeat(69)}Prenotazione obbligatoria.`;
  const { booking_notes: notes } = classifyBookingText(text);
  for (let index = 0; index < notes.length; index += 1) {
    const code = notes.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = notes.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff);
      index += 1;
    } else {
      assert.ok(code < 0xdc00 || code > 0xdfff);
    }
  }
});

test("recognizes explicit open access and no-reservation statements", () => {
  assert.equal(classifyBookingText("Ingresso libero.").status, "free");
  assert.equal(classifyBookingText("Accesso libero.").status, "free");
  assert.equal(classifyBookingText("Non è necessaria la prenotazione.").status, "not_required");
  assert.equal(classifyBookingText("Non è richiesta la prenotazione.").booking_required, false);
  assert.equal(classifyBookingText("È necessaria la prenotazione.").status, "required");
  assert.equal(classifyBookingText("La prenotazione è richiesta.").status, "required");
});

test("leaves contradictory or absent evidence unclassified", () => {
  assert.equal(
    classifyBookingText("Prenotazione obbligatoria ma non è richiesta alcuna prenotazione.").status,
    "unclassified"
  );
  assert.equal(
    classifyBookingText("Prenotazione obbligatoria, ma la prenotazione non è richiesta.").status,
    "unclassified"
  );
  assert.equal(
    classifyBookingText("Non c'è obbligo di prenotazione.").status,
    "not_required"
  );
  assert.equal(
    classifyBookingText("Posti limitati, prenotazione consigliata.").status,
    "recommended"
  );
  assert.equal(
    classifyBookingText("Iscrizione obbligatoria, ingresso libero.").status,
    "required"
  );
  assert.equal(
    classifyBookingText("Prenotazione obbligatoria e prenotazione consigliata.").status,
    "unclassified"
  );
  assert.equal(
    classifyBookingText("Prenotazione consigliata ma non occorre prenotare.").status,
    "unclassified"
  );
  assert.equal(
    classifyBookingText("Prenotazione obbligatoria e ingresso libero.").status,
    "required"
  );
  assert.equal(
    classifyBookingText("Non c'è obbligo di prenotazione.").booking_required,
    false
  );
  assert.deepEqual(classifyBookingText("Informazioni sull'evento."), {
    status: "unclassified",
    booking_required: null,
    booking_notes: null
  });
});
