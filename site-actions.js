// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
import { App } from "./js/app.js";

class SiteActions {
  static registerActions(actions) {
    actions.register({
      name: "get_page_state",
      description: "Read the document on the page as a REDACTED copy (personal details replaced by placeholders like [NAME 1]), how many details were hidden, the samples, the pinned notes, and what this site can and cannot do. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    });
    actions.register({
      name: "load_sample",
      description: "Put one of the sample documents on the page, replacing the current one. Use an id from get_page_state samples.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", enum: ["bank", "lab", "rent", "power"], description: "bank (KYC letter), lab (blood test report), rent (rental agreement) or power (electricity disconnection notice)." } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: (args) => App.page.loadSample(args),
    });
    actions.register({
      name: "pin_note",
      description: "Pin a short note beside the document for the visitor, such as a plain summary, a checklist of what to do, or the deadlines. Use placeholders as they are; the page shows the visitor their real details.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short title, such as 'What to do' or 'Deadlines'." },
          body: { type: "string", description: "The note, in plain words. Short lines or bullet points." },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
      execute: (args) => App.page.pinNote(args),
    });
    actions.register({
      name: "clear_notes",
      description: "Remove every pinned note from the page.",
      effect: "write",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.clearNotes(),
    });
  }
}

export function registerActions(actions) {
  SiteActions.registerActions(actions);
}

export default SiteActions;
