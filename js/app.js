// The page object. The page's own buttons and the assistant's website_* tools both call
// these methods, so there is one set of rules.
//
// Privacy by construction: the agents never receive the original document. Every read
// returns the redacted copy, with personal details replaced by placeholders such as
// [NAME 1]. The placeholder map stays in this page and is used only to show the visitor
// their own details again.

import { ruleSpans, redact, restore, KIND_LABEL } from './redact.js';
import { SAMPLES } from './samples.js';

class Page {
  constructor() {
    this.original = '';
    this.title = '';
    this.red = { text: '', map: new Map(), count: 0 };
    this.notes = []; // notes the assistant pinned for the visitor
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  changed() {
    for (const fn of this.listeners) fn(this);
  }

  /** Read action: everything the assistant may know about the page. Changes nothing. */
  getState() {
    const kinds = {};
    for (const ph of this.red.map.keys()) {
      const k = ph.replace(/^\[|\s\d+\]$/g, '');
      kinds[k] = (kinds[k] || 0) + 1;
    }
    return {
      ok: true,
      has_document: !!this.original,
      title: this.title || null,
      redacted_document: this.red.text || null,
      hidden_details: this.red.count,
      hidden_by_type: kinds,
      placeholders_note: 'Personal details are replaced by placeholders like [NAME 1]. Use the placeholders as they are. The visitor sees their real details on the page.',
      samples: SAMPLES.map((s) => ({ id: s.id, title: s.title, about: s.blurb })),
      pinned_notes: this.notes.map((n) => n.title),
      site_can_do: [
        'Hide personal details (names, addresses, Aadhaar, PAN, IFSC, UPI, card, account and phone numbers, dates of birth) before anything is read',
        'Load a sample document',
        'Pin a plain-language summary or checklist next to the document',
      ],
      site_cannot_do: [
        'Read photos (paste the text instead)',
        'Send anything to the bank, landlord, hospital or power company',
        'Give legal, financial or medical advice',
        'Store documents: everything is gone when the tab closes',
      ],
    };
  }

  /** Put a document on the page (from the visitor's paste or a sample). */
  setDocument(text, title = '') {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, reason: 'The document is empty.', field: 'text' };
    if (clean.length > 20000) return { ok: false, reason: 'The document is too long (over 20,000 characters).', field: 'text' };
    this.original = clean;
    this.title = title;
    this.red = redact(clean, ruleSpans(clean));
    this.notes = [];
    this.changed();
    return { ok: true, hidden_details: this.red.count };
  }

  /** Write action: load one of the sample documents. */
  loadSample({ id }) {
    const want = String(id || '').toLowerCase();
    const alias = { electricity: 'power', bill: 'power', blood: 'lab', report: 'lab', rental: 'rent', agreement: 'rent', kyc: 'bank' };
    const s = SAMPLES.find((x) => x.id === want)
      || SAMPLES.find((x) => want.includes(x.id))
      || SAMPLES.find((x) => Object.entries(alias).some(([k, v]) => want.includes(k) && v === x.id));
    if (!s) return { ok: false, reason: `There is no sample "${id}". Samples: ${SAMPLES.map((x) => x.id).join(', ')}.`, field: 'id' };
    const r = this.setDocument(s.text, s.title);
    // Return the redacted text too, so the agent can explain it straight away.
    return { ...r, title: s.title, redacted_document: this.red.text };
  }

  /** Write action: pin a note (summary, checklist, deadline) beside the document. */
  pinNote({ title, body }) {
    if (!this.original) return { ok: false, reason: 'There is no document on the page yet.' };
    const t = String(title || '').trim().slice(0, 80);
    const b = String(body || '').trim().slice(0, 1500);
    if (!t || !b) return { ok: false, reason: 'A note needs a title and a body.', field: !t ? 'title' : 'body' };
    this.notes = [...this.notes.filter((n) => n.title !== t), { title: t, body: b }].slice(-6);
    this.changed();
    return { ok: true, pinned: t, notes_on_page: this.notes.length };
  }

  /** Write action: remove pinned notes. */
  clearNotes() {
    const n = this.notes.length;
    this.notes = [];
    this.changed();
    return { ok: true, removed: n };
  }

  /** For display only: show the visitor's real details again. */
  restoreForVisitor(text) {
    return restore(String(text || ''), this.red.map);
  }

  label(kind) {
    return KIND_LABEL[kind] || kind;
  }
}

export class App {
  static page = new Page();
}
