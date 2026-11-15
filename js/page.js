// The page's own UI. It uses the same App.page methods as the assistant's tools.
import { App } from './app.js';
import { SAMPLES } from './samples.js';
import { ruleSpans, mergeSpans, KIND_LABEL } from './redact.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let view = 'mine';

function render(page) {
  const has = !!page.original;
  $('#editor').hidden = has;
  $('#btn-edit').hidden = !has;
  $('#hidden-line').hidden = !has;
  $('#view-mine').hidden = !has || view !== 'mine';
  $('#view-agents').hidden = !has || view !== 'agents';
  if (!has) {
    $('#notes').innerHTML = '';
    return;
  }
  $('#hidden-line').innerHTML = `🔒 <b>${page.red.count}</b> personal detail${page.red.count === 1 ? '' : 's'} hidden. The agents only ever get the copy on the right tab.`;
  // highlight the hidden details in the visitor's own view
  const spans = mergeSpans(ruleSpans(page.original));
  let html = '';
  let pos = 0;
  for (const s of spans) {
    html += esc(page.original.slice(pos, s.start)) + `<mark>${esc(s.text)}<sup>${esc(KIND_LABEL[s.kind])}</sup></mark>`;
    pos = s.end;
  }
  $('#view-mine').innerHTML = html + esc(page.original.slice(pos));
  $('#view-agents').innerHTML = esc(page.red.text).replace(/\[([A-Z][A-Z ]*? \d+)\]/g, '<span class="ph">[$1]</span>');
  $('#notes').innerHTML = page.notes
    .map((n) => `<div class="note"><b>📌 ${esc(page.restoreForVisitor(n.title))}</b><div>${esc(page.restoreForVisitor(n.body)).replace(/\n/g, '<br>')}</div><span class="muted small">Pinned by the assistant · your details filled back in on this page</span></div>`)
    .join('');
}

App.page.onChange(render);
$('#samples').innerHTML = SAMPLES.map((s) => `<button class="chip" data-id="${s.id}">${esc(s.title)}</button>`).join('');
for (const b of document.querySelectorAll('.chip')) b.onclick = () => App.page.loadSample({ id: b.dataset.id });
$('#btn-hide').onclick = () => {
  const r = App.page.setDocument($('#paste').value, 'Your document');
  if (!r.ok) alert(r.reason);
};
$('#btn-edit').onclick = () => {
  App.page.original = '';
  App.page.notes = [];
  App.page.red = { text: '', map: new Map(), count: 0 };
  App.page.changed();
};
for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    view = t.dataset.view;
    for (const o of document.querySelectorAll('.tab')) o.classList.toggle('on', o === t);
    render(App.page);
  };
}
render(App.page);
