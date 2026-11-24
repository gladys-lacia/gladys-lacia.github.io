/* VA Service Tool 1: Consultations tabs.
   Add tab creates a vertical tab (#1, #2, #3...) holding a client form: client, dates, notes, goals, audience profile.
   Each added tab has a Delete tab button, and each note has Copy, View, Edit and Delete.
   Deleting asks the user to type DELETE. For now everything lives in memory only; saving to the database comes later. */
(() => {
  "use strict";

  const DELETE_PHRASE = "DELETE";
  const UNLOCK_PHRASE = "UNLOCK";
  const UNITS = { hr: "USD/hr", day: "USD/day", wk: "USD/wk", d15: "USD/15 days", mo: "USD/mo" };
  const MIN_YEAR = 2026;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const GOALS = [["goal_traffic", "Driving Traffic"], ["goal_leads", "Generating Leads"], ["goal_sales", "Driving Sales"], ["goal_awareness", "Building Brand Awareness"]];
  const AUDIENCE = [
    ["aud_role", "Role / title", "area"],
    ["aud_industry", "Industry / context", "area"],
    ["aud_goal", "Main goal", "area"],
    ["aud_pains", "Top 3 pain points", "pains"],
    ["aud_objection", "Biggest objection", "area"],
    ["aud_level", "Knowledge level", "select", ["Beginner", "Intermediate", "Advanced"]],
    ["aud_where", "Where they hang out", "area"],
    ["aud_words", "Words they use", "area"],
    ["aud_content", "Content goal", "select", ["Traffic", "Leads", "Sales", "Awareness"]],
    ["aud_next", "Desired next action", "area"]
  ];

  const $ = (id) => document.getElementById(id);
  const addButton = $("addTabButton");
  const blank = $("consultationsBlank");
  const tabset = $("consultationsTabset");
  const rail = $("consultationsRail");
  const paneHost = $("consultationsPane");
  const deletePopup = $("deleteTabPopup");
  const deleteTitle = $("deleteTabTitle");
  const deleteText = $("deleteTabText");
  const deletePhrase = $("deleteTabPhrase");
  const deleteConfirm = $("deleteTabConfirm");
  const noteForm = $("noteFormPopup");
  const noteFormTitle = $("noteFormTitle");
  const noteName = $("noteName");
  const noteText = $("noteText");
  const noteError = $("noteError");
  const noteView = $("noteViewPopup");
  const noteCompField = $("noteCompetitorField");
  const noteCompetitor = $("noteCompetitor");
  const unlockPopup = $("unlockTabPopup");
  const unlockPhrase = $("unlockTabPhrase");
  const unlockConfirm = $("unlockTabConfirm");

  const state = {
    tabs: [],          // { id, number, locked, data: {...form values}, notes: [{ id, title, text }] }
    activeId: null,
    nextId: 1,
    nextNoteId: 1,
    deleting: null,    // { kind: "tab", tabId }, { kind: "note", tabId, noteId } or { kind: "template", id }
    editingNote: null, // { tabId, note | null }
    unlocking: null    // id of the tab waiting for the UNLOCK confirmation
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- Form markup (static text only; saved values are filled in afterwards) ---------- */

  const monthOptions = '<option value="">Select month</option>' + MONTHS.map((name, i) => `<option value="${i + 1}">${name}</option>`).join("");
  const textField = (key, label, placeholder) => `<label class="f">${label}<input data-f="${key}" type="text" maxlength="500" placeholder="${placeholder || ""}" autocomplete="off"></label>`;
  const areaField = (key, label) => `<label class="f">${label}<textarea data-f="${key}" rows="3" maxlength="2000"></textarea></label>`;
  const monthField = (key, label) => `<label class="f">${label}<select data-f="${key}">${monthOptions}</select></label>`;
  const yearField = (key, label) => `<label class="f">${label}<input data-f="${key}" type="text" inputmode="numeric" maxlength="4" placeholder="${MIN_YEAR} or later" autocomplete="off"></label>`;

  const selectField = (key, label, options) => `<label class="f">${label}<select data-f="${key}"><option value="">Select</option>${options.map((option) => `<option value="${option}">${option}</option>`).join("")}</select></label>`;
  const painsField = (label) => `<div class="f">${label}${[1, 2, 3].map((n) => `<input data-f="aud_pain${n}" type="text" maxlength="500" autocomplete="off" aria-label="${label} ${n}">`).join("")}</div>`;
  const audienceField = ([key, label, type, options]) => (type === "pains" ? painsField(label) : type === "select" ? selectField(key, label, options) : areaField(key, label));

  function paneHTML(number) {
    return `<div class="pane-head"><h2>#${number}</h2><div class="pane-tools"><span class="status" data-status></span><button class="ic tool" type="button" data-lock></button></div></div>
<p class="form-error" data-lockerr role="alert" hidden>Fill in the End month and End year before locking an Inactive tab.</p>
<div class="form">
  <div class="row" data-raterow>
    <label class="f grow">Client<input data-f="client" type="text" maxlength="500" autocomplete="off"></label>
    <label class="f">Rate type<select data-f="rate_type"><option value="hr">Hourly Rate</option><option value="day">Daily Rate</option><option value="wk">Weekly Rate</option><option value="d15">Every 15 days</option><option value="mo">Monthly Rate</option></select></label>
    <label class="f rate">Rate<span class="amount"><input data-f="rate_amount" type="text" inputmode="decimal" maxlength="12" placeholder="0.00" autocomplete="off"><span class="unit" data-unit>USD/hr</span></span></label>
  </div>
  <p class="form-error" data-rateerr role="alert" hidden>Enter an amount greater than 0.</p>
  <label class="check"><input type="checkbox" data-f="working"> I’m currently working with this client.</label>
  <div class="row">${monthField("sm", "Start month")}${yearField("sy", "Start year")}</div>
  <div class="row">
    ${monthField("em", "End month")}${yearField("ey", "End year")}
    <p class="form-error" data-alert role="alert" hidden>The resignation date shouldn’t be before the hire date.</p>
  </div>
  <p class="form-error" data-yearerr role="alert" hidden>The year must be ${MIN_YEAR} or later.</p>

  <section class="block">
    <div class="block-head"><h3>Notes</h3><button class="ic tool" type="button" data-addnote title="Add notes" aria-label="Add notes"><svg aria-hidden="true"><use href="#i-bmadd"/></svg></button></div>
    <div class="notes-grid" data-notes></div>
  </section>

  <section class="block">
    <h3>Goals</h3>
    <div class="checklist">${GOALS.map(([key, label]) => `<label class="check"><input type="checkbox" data-f="${key}"> ${label}</label>`).join("")}</div>
  </section>

  <section class="block">
    <h3>Audience Profile</h3>
    <div class="stack">${AUDIENCE.map(audienceField).join("")}</div>
  </section>
</div>
<div class="pane-foot"><button class="ic tool danger" type="button" data-deltab title="Delete tab" aria-label="Delete tab" popovertarget="deleteTabPopup"><svg aria-hidden="true"><use href="#i-del"/></svg></button></div>`;
  }

  /* ---------- Rate ---------- */

  // Digits and one decimal point only, with at most two decimal places.
  function cleanAmount(value) {
    let text = value.replace(/[^\d.]/g, "");
    const dot = text.indexOf(".");
    if (dot !== -1) text = text.slice(0, dot + 1) + text.slice(dot + 1).replace(/\./g, "").slice(0, 2);
    return text;
  }

  /* ---------- Dates ---------- */

  // A month and a four-digit year of 2026 or later become one number that can be compared; otherwise null.
  function monthIndex(month, year) {
    if (!month || !year || year.length !== 4 || Number(year) < MIN_YEAR) return null;
    return Number(year) * 12 + Number(month);
  }

  function syncDates(pane, tab) {
    const data = tab.data;
    const working = Boolean(data.working);
    pane.querySelector('[data-f="em"]').disabled = working || tab.locked;
    pane.querySelector('[data-f="ey"]').disabled = working || tab.locked;

    // The Active / Inactive label follows the "currently working" checkbox.
    const status = pane.querySelector("[data-status]");
    status.textContent = working ? "Active" : "Inactive";
    status.className = working ? "status active" : "status inactive";

    const start = monthIndex(data.sm, data.sy);
    const end = monthIndex(data.em, data.ey);
    pane.querySelector("[data-alert]").hidden = !(!working && start !== null && end !== null && end < start);

    const years = working ? [data.sy] : [data.sy, data.ey];
    pane.querySelector("[data-yearerr]").hidden = !years.some((year) => year && year.length === 4 && Number(year) < MIN_YEAR);

    // The unit beside the amount follows the rate type, and an amount of 0 is not allowed.
    pane.querySelector("[data-unit]").textContent = UNITS[data.rate_type] || UNITS.hr;
    const amount = data.rate_amount;
    pane.querySelector("[data-rateerr]").hidden = !(amount && Number(amount) <= 0);
    // An amount below 3.00 turns the text of the Client, Rate type and Rate fields red.
    pane.querySelector("[data-raterow]").classList.toggle("low-rate", amount !== "" && amount !== undefined && Number(amount) < 3);
  }

  /* ---------- Notes ---------- */

  async function copyText(text, button) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    button.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  }

  // Notes live in a Consultations tab (scope "consult"), in its Competition Analysis subtab (scope "comp"),
  // or on the Research Notes tab (scope "research", which belongs to no client).
  function notesOf(tab, scope) {
    if (scope === "research") return research.items;
    return scope === "comp" ? tab.comp.notes : tab.notes;
  }

  function noteCard(tab, note, scope = "consult") {
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(note.text, copy));

    const view = el("button", "ic bare view");
    view.type = "button";
    view.title = "View details";
    view.setAttribute("aria-label", "View details");
    view.innerHTML = '<svg aria-hidden="true"><use href="#i-view"/></svg>'; // static markup only
    view.addEventListener("click", () => {
      $("noteViewTitle").textContent = note.title;
      $("noteViewText").textContent = note.text;
      noteView.showPopover();
    });

    const body = el("div", "bm-body");
    body.appendChild(el("h3", "", note.title));
    const owner = scope === "comp" ? compOwnerName(tab, note) : "";
    if (owner) body.appendChild(el("p", "bm-for", `Competitor: ${owner}`));
    body.appendChild(el("p", "bm-snippet", note.text));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "note", tabId: tab ? tab.id : null, noteId: note.id, scope }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openNoteForm(tab, note, scope));
    del.disabled = edit.disabled = scope === "consult" ? tab.locked : scope === "comp" ? !tab.data.working : false; // locked (Consultations) or an Inactive client (Competition Analysis)

    card.append(copy, view, body, del, edit);
    return card;
  }

  function renderNotes(pane, tab, scope = "consult") {
    const grid = pane.querySelector("[data-notes]");
    grid.replaceChildren();
    const list = notesOf(tab, scope);
    if (!list.length) {
      grid.appendChild(el("p", "empty", "No notes yet. Use the Add notes button to save your first one."));
      return;
    }
    list.forEach((note) => grid.appendChild(noteCard(tab, note, scope)));
  }

  function openNoteForm(tab, note, scope = "consult") {
    state.editingNote = { tabId: tab ? tab.id : null, note: note || null, scope };
    noteFormTitle.textContent = note ? "Edit note" : "Add a note";
    noteName.value = note ? note.title : "";
    noteText.value = note ? note.text : "";
    noteError.hidden = true;
    // On Competition Analysis a note belongs to one of the competitors in that subtab.
    noteCompField.hidden = scope !== "comp";
    if (scope === "comp") {
      noteCompetitor.replaceChildren();
      tab.comp.competitors.forEach((item) => {
        const option = el("option", "", compLabel(tab, item));
        option.value = String(item.id);
        noteCompetitor.appendChild(option);
      });
      if (!noteCompetitor.options.length) {
        const none = el("option", "", "No competitors yet");
        none.value = "";
        noteCompetitor.appendChild(none);
      }
      if (note && note.competitorId) noteCompetitor.value = String(note.competitorId);
    }
    noteForm.showPopover();
    noteName.focus();
  }

  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const editing = state.editingNote;
    if (!editing) return;
    let competitorId = null;
    if (editing.scope === "comp") {
      competitorId = Number(noteCompetitor.value) || null;
      if (!competitorId) {
        noteError.textContent = "Choose a competitor. Add one with + Add competitors first.";
        noteError.hidden = false;
        return;
      }
    }
    const title = noteName.value.trim();
    const text = noteText.value.trim();
    if (!title || !text) {
      noteError.textContent = !title ? "Enter what this note is for." : "Write your notes.";
      noteError.hidden = false;
      return;
    }
    const tab = editing.scope === "research" ? null : state.tabs.find((item) => item.id === editing.tabId);
    if (!tab && editing.scope !== "research") return;
    if (editing.note) {
      editing.note.title = title;
      editing.note.text = text;
      if (editing.scope === "comp") editing.note.competitorId = competitorId;
    } else {
      notesOf(tab, editing.scope).push({ id: state.nextNoteId++, title, text, competitorId });
    }
    state.editingNote = null;
    noteForm.hidePopover();
    render();
    renderResearchNotes();
  });

  /* ---------- Tabs ---------- */

  /* The next title is one more than the highest number in use, so #1 starts again when every tab is gone. */
  function nextNumber() {
    return state.tabs.reduce((max, tab) => Math.max(max, tab.number), 0) + 1;
  }

  /* The tabs are kept in three groups, from top to bottom: Active tabs, then locked Inactive tabs, then unlocked Inactive tabs.
     A tab whose group changes (it is checked or unchecked as "currently working", or an Inactive tab is locked or unlocked)
     moves to the end of its new group. So an Inactive tab that is locked for the first time lands right after the last Active tab,
     and later ones land right after the last locked Inactive tab. */
  const tabGroup = (tab) => (tab.data.working ? 0 : tab.locked ? 1 : 2);
  function moveAfterLock(tab) {
    const others = state.tabs.filter((item) => item !== tab);
    const group = tabGroup(tab);
    let at = 0;
    others.forEach((item, index) => { if (tabGroup(item) <= group) at = index + 1; });
    others.splice(at, 0, tab);
    state.tabs = others;
  }

  function paintLock(button, tab) {
    button.innerHTML = `<svg aria-hidden="true"><use href="#${tab.locked ? "i-lock" : "i-unlock"}"/></svg>`; // static markup only
    const label = tab.locked ? "Unlock tab" : "Lock tab";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function buildPane(tab) {
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", `#${tab.number}`);
    pane.innerHTML = paneHTML(tab.number); // static markup only; saved values are set below as values, never as HTML

    pane.querySelectorAll("[data-f]").forEach((field) => {
      const key = field.dataset.f;
      const isCheck = field.type === "checkbox";
      if (isCheck) field.checked = Boolean(tab.data[key]);
      else field.value = tab.data[key] || "";
      field.disabled = tab.locked;
      if (key === "rate_amount") {
        // When the user leaves the field, show it with exactly two decimal places.
        field.addEventListener("change", () => {
          const amount = Number(field.value);
          if (field.value === "." || field.value === "") field.value = "";
          else if (amount > 0) field.value = amount.toFixed(2);
          tab.data[key] = field.value;
          syncDates(pane, tab);
        });
      }
      field.addEventListener("input", () => {
        if (key === "sy" || key === "ey") field.value = field.value.replace(/\D/g, "").slice(0, 4);
        if (key === "rate_amount") field.value = cleanAmount(field.value);
        tab.data[key] = isCheck ? field.checked : field.value;
        pane.querySelector("[data-lockerr]").hidden = true;
        syncDates(pane, tab);
        if (key === "working") { moveAfterLock(tab); render(); } // Active tabs stay above Inactive tabs
      });
    });
    syncDates(pane, tab);
    renderNotes(pane, tab);

    const addNote = pane.querySelector("[data-addnote]");
    addNote.disabled = tab.locked;
    addNote.addEventListener("click", () => openNoteForm(tab, null));

    const lock = pane.querySelector("[data-lock]");
    paintLock(lock, tab);
    lock.addEventListener("click", () => {
      if (!tab.locked) {
        // An Inactive tab can only be locked once its End month and End year are filled in.
        if (!tab.data.working && monthIndex(tab.data.em, tab.data.ey) === null) {
          pane.querySelector("[data-lockerr]").hidden = false;
          pane.querySelector(tab.data.em ? '[data-f="ey"]' : '[data-f="em"]').focus();
          return;
        }
        tab.locked = true;
        if (!tab.data.working) moveAfterLock(tab);
        render();
      } else if (tab.data.working) {
        tab.locked = false;
        render();
      } else {
        state.unlocking = tab.id; // an Inactive tab needs the UNLOCK confirmation first
        unlockPopup.showPopover();
      }
    });
    pane.querySelector("[data-deltab]").addEventListener("click", () => { state.deleting = { kind: "tab", tabId: tab.id }; });
    return pane;
  }

  function render() {
    const hasTabs = state.tabs.length > 0;
    blank.hidden = hasTabs;
    tabset.hidden = !hasTabs;
    rail.replaceChildren();
    paneHost.replaceChildren();
    if (!hasTabs) { renderLanguages(); renderKeywords(); renderCompetition(); renderContent(); renderCommunity(); renderAnalyses(); return; }

    const open = state.tabs.find((tab) => tab.id === state.activeId) || state.tabs[0];
    state.activeId = open.id;

    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      button.title = `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        state.activeId = tab.id;
        render();
      });
      rail.appendChild(button);
    });
    paneHost.appendChild(buildPane(open));
    renderLanguages();
    renderKeywords();
    renderCompetition();
    renderContent();
    renderCommunity();
    renderAnalyses();
  }

  addButton.addEventListener("click", () => {
    const tab = { id: state.nextId++, number: nextNumber(), data: { rate_type: "hr" }, notes: [], locked: false, comp: { competitors: [], notes: [], templateId: null, analysis: null } };
    state.tabs.push(tab);
    state.activeId = tab.id; // open the tab that was just made
    render();
  });

  /* ---------- Delete popup (shared by tabs and notes) ---------- */

  // The Delete button stays disabled until DELETE is typed exactly.
  deletePhrase.addEventListener("input", () => {
    deleteConfirm.disabled = deletePhrase.value !== DELETE_PHRASE;
  });

  // Start fresh every time the popup opens, and word it for what is being deleted.
  deletePopup.addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    const kind = state.deleting ? state.deleting.kind : "tab";
    const name = kind === "keywords" ? "keyword set" : kind === "contentitem" ? "content" : kind === "avoid" ? "list of words and phrases" : kind === "workflow" ? "workflow analysis" : kind;
    deleteTitle.textContent = `Delete this ${name}?`;
    deleteText.textContent = kind === "tab"
      ? "This permanently removes this tab and everything inside it, including from the database."
      : kind === "competitor"
        ? "This permanently removes this competitor and its notes, including from the database."
        : `This permanently removes this ${name}, including from the database.`;
    deletePhrase.value = "";
    deleteConfirm.disabled = true;
    deletePhrase.focus();
  });

  deleteConfirm.addEventListener("click", () => {
    const target = state.deleting;
    if (deletePhrase.value !== DELETE_PHRASE || !target) return;
    if (target.kind === "tab") {
      state.tabs = state.tabs.filter((tab) => tab.id !== target.tabId);
      if (state.activeId === target.tabId) state.activeId = null;
      bank.items = bank.items.filter((item) => item.clientId !== target.tabId);
      kw.items = kw.items.filter((item) => item.clientId !== target.tabId);
    } else if (target.kind === "note" && target.scope === "research") {
      research.items = research.items.filter((note) => note.id !== target.noteId);
    } else if (target.kind === "competitor") {
      const tab = state.tabs.find((item) => item.id === target.tabId);
      if (tab) {
        tab.comp.competitors = tab.comp.competitors.filter((item) => item.id !== target.competitorId);
        tab.comp.notes = tab.comp.notes.filter((note) => note.competitorId !== target.competitorId);
      }
    } else if (target.kind === "keywords") {
      kw.items = kw.items.filter((item) => item.id !== target.id);
      renderKeywords();
    } else if (target.kind === "language") {
      bank.items = bank.items.filter((item) => item.id !== target.id);
      renderLanguages();
    } else if (target.kind === "contentitem") {
      const tab = state.tabs.find((item) => item.id === target.tabId);
      if (tab) contOf(tab).items = contOf(tab).items.filter((item) => item.id !== target.itemId);
    } else if (target.kind === "post") {
      const tab = state.tabs.find((item) => item.id === target.tabId);
      if (tab) commOf(tab).items = commOf(tab).items.filter((item) => item.id !== target.itemId);
    } else if (target.kind === "analysis") {
      const tab = state.tabs.find((item) => item.id === target.tabId);
      if (tab) aaOf(tab).items = aaOf(tab).items.filter((item) => item.id !== target.id);
    } else if (target.kind === "workflow") {
      wf.items = wf.items.filter((item) => item.id !== target.id);
      renderWorkflows();
    } else if (target.kind === "avoid") {
      avoid.items = avoid.items.filter((item) => item.id !== target.id);
      renderAvoid();
    } else if (target.kind === "report") {
      reports.items = reports.items.filter((item) => item.id !== target.id);
      renderReports();
    } else if (target.kind === "template") {
      ismco.items = ismco.items.filter((item) => item.id !== target.id);
      renderTemplates();
    } else {
      const tab = state.tabs.find((item) => item.id === target.tabId);
      if (tab) {
        const kept = notesOf(tab, target.scope).filter((note) => note.id !== target.noteId);
        if (target.scope === "comp") tab.comp.notes = kept;
        else tab.notes = kept;
      }
    }
    state.deleting = null;
    render();
    renderResearchNotes();
  });

  /* ---------- ISMCO templates (Research & Ideation Support) ---------- */

  const ISMCO_FIELDS = [["INTENT", "intent"], ["SCOPE", "scope"], ["METHOD", "method"], ["CONSTRAINTS", "constraints"], ["OUTPUT", "output"]];
  // The "Applies to" choices are placeholders for now; what they do gets built later.
  const APPLIES_TO = { competition: "Competition Analysis", community: "Community Management & Engagement", content: "Content & Editorial", audience: "Audience Analysis", workflow: "Workflow Analysis" };
  const ismcoGrid = $("ismcoGrid");
  const templateForm = $("templateFormPopup");
  const templateView = $("templateViewPopup");
  const templateError = $("templateError");
  const ismco = { items: [], nextId: 1, editing: null };

  // Times are always shown in UTC+8, whatever the device clock says.
  function fmtStamp(iso) {
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    const hour = d.getUTCHours();
    return `${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} at ${hour % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"} UTC+8`;
  }

  function iconButton(symbol, label) {
    const button = el("button", "ic bare");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg aria-hidden="true"><use href="#${symbol}"/></svg>`; // static markup only
    return button;
  }

  function renderTemplates() {
    ismcoGrid.replaceChildren();
    if (!ismco.items.length) {
      ismcoGrid.appendChild(el("p", "empty", "No ISMCO templates yet. Choose + Add template to save your first one."));
      return;
    }
    ismco.items.forEach((item) => {
      const card = el("article", "card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.append(el("h3", "", item.title), el("p", "", item.intent));
      card.addEventListener("click", () => openTemplateView(item));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTemplateView(item);
        }
      });
      ismcoGrid.appendChild(card);
    });
  }

  // View popup: edit and delete on the left, close on the right.
  function openTemplateView(item) {
    const edit = iconButton("i-edit", "Edit");
    edit.addEventListener("click", () => { templateView.hidePopover(); openTemplateForm(item); });
    const del = iconButton("i-del", "Delete");
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "template", id: item.id }; });
    const close = iconButton("i-x", "Close");
    close.setAttribute("popovertarget", "templateViewPopup");
    close.setAttribute("popovertargetaction", "hide");
    const heading = el("h2", "", item.title);
    heading.id = "templateViewTitle";
    const head = el("header", "head");
    head.append(edit, del, heading, close);

    const list = el("dl", "dl");
    ISMCO_FIELDS.forEach(([label, key]) => list.append(el("dt", "", label), el("dd", "", item[key])));
    const avoidItem = avoid.items.find((entry) => entry.id === item.avoid);
    list.append(el("dt", "", "Words and Phrases to Avoid"), el("dd", "", avoidItem ? avoidItem.title : "None"));
    list.append(el("dt", "", "Applies to"), el("dd", "", APPLIES_TO[item.applies] || item.applies));

    templateView.replaceChildren(head, el("p", "sub", `Updated last ${fmtStamp(item.updated)}.`), list);
    templateView.showPopover();
  }

  // Add and edit use the same popup.
  function openTemplateForm(item) {
    ismco.editing = item || null;
    $("templateFormTitle").textContent = item ? "Edit ISMCO template" : "Add an ISMCO template";
    $("tpl-name").value = item ? item.title : "";
    ISMCO_FIELDS.forEach(([, key]) => { $(`tpl-${key}`).value = item ? item[key] : ""; });
    $("tpl-applies").value = item ? item.applies : "competition";
    setOptions($("tpl-avoid"), avoid.items.map((entry) => [entry.id, entry.title]), item && item.avoid, "None", true);
    templateError.hidden = true;
    templateForm.showPopover();
    $("tpl-name").focus();
  }

  templateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("tpl-name").value.trim();
    if (!title) {
      templateError.textContent = "Enter what this prompt is for.";
      templateError.hidden = false;
      return;
    }
    const values = { title, applies: $("tpl-applies").value, avoid: Number($("tpl-avoid").value) || null, updated: new Date().toISOString() };
    ISMCO_FIELDS.forEach(([, key]) => { values[key] = $(`tpl-${key}`).value.trim(); });
    if (ismco.editing) Object.assign(ismco.editing, values);
    else ismco.items.unshift({ id: ismco.nextId++, ...values });
    ismco.editing = null;
    templateForm.hidePopover();
    renderTemplates();
  });

  $("addTemplateButton").addEventListener("click", () => openTemplateForm(null));

  /* ---------- Language Bank (Research & Ideation Support) ---------- */

  const languageBlank = $("languageBlank");
  const languageTabset = $("languageTabset");
  const languageRail = $("languageRail");
  const languageHost = $("languagePane");
  const languageForm = $("languageFormPopup");
  const languageView = $("languageViewPopup");
  const languageError = $("languageError");
  const langName = $("lang-name");
  const langText = $("lang-text");
  const bank = { items: [], nextId: 1, editing: null, tabId: null, activeId: null };

  const tabById = (id) => state.tabs.find((tab) => tab.id === id);
  const clientLabel = (tab) => (tab.data.client || "").trim() || `#${tab.number}`;
  // The client's current name; if that tab has been deleted, the name saved with the entry.
  const entryClient = (entry) => { const tab = tabById(entry.clientId); return tab ? clientLabel(tab) : entry.clientName; };

  // Cards work like the Content cards: Copy, View, Edit and Delete.
  function languageCard(tab, entry) {
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(entry.text, copy));

    const view = iconButton("i-view", "View details");
    view.classList.add("view");
    view.addEventListener("click", () => {
      $("languageViewTitle").textContent = entry.title;
      $("languageViewText").textContent = entry.text;
      languageView.showPopover();
    });

    const body = el("div", "bm-body");
    body.append(el("h3", "", entry.title), el("p", "bm-snippet", entry.text));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "language", id: entry.id }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openLanguageForm(tab, entry));
    del.disabled = edit.disabled = !tab.data.working; // an Inactive client cannot change its language banks

    card.append(copy, view, body, del, edit);
    return card;
  }

  function buildLanguagePane(tab) {
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", clientLabel(tab));
    pane.innerHTML = '<div class="pane-head"><h2 data-title></h2></div><div class="form"><div class="notes-grid" data-items></div></div>'; // static markup only; names are set below as text
    pane.querySelector("[data-title]").textContent = clientLabel(tab);
    const grid = pane.querySelector("[data-items]");
    const items = bank.items.filter((entry) => entry.clientId === tab.id);
    if (!items.length) grid.appendChild(el("p", "empty", "No languages yet. Use the + Add language button to save your first one."));
    else items.forEach((entry) => grid.appendChild(languageCard(tab, entry)));
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderLanguages() {
    const hasTabs = state.tabs.length > 0;
    languageBlank.hidden = hasTabs;
    languageTabset.hidden = !hasTabs;
    $("addLanguageButton").disabled = !hasTabs;
    languageRail.replaceChildren();
    languageHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === bank.activeId) || state.tabs[0];
    bank.activeId = open.id;
    $("addLanguageButton").disabled = !open.data.working; // an Inactive client cannot get new language banks
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      const name = (tab.data.client || "").trim();
      button.title = name ? `#${tab.number} – ${name}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        bank.activeId = tab.id;
        renderLanguages();
      });
      languageRail.appendChild(button);
    });
    languageHost.appendChild(buildLanguagePane(open));
  }

  // The dropdown lists the clients whose tabs are Active. When editing, the original client stays selectable.
  function fillClientSelect(select, selectedId, entry) {
    select.replaceChildren();
    const add = (value, label) => { const option = el("option", "", label); option.value = String(value); select.appendChild(option); };
    const active = state.tabs.filter((tab) => tab.data.working);
    active.forEach((tab) => add(tab.id, clientLabel(tab)));
    if (selectedId && !active.some((tab) => tab.id === selectedId)) add(selectedId, `${entryClient(entry)} (no longer Active)`);
    if (!select.options.length) add("", "No Active clients yet");
    select.value = selectedId ? String(selectedId) : select.options[0].value;
  }

  // Add and edit use the same popup.
  function openLanguageForm(tab, entry) {
    bank.tabId = tab.id;
    bank.editing = entry || null;
    $("languageFormTitle").textContent = entry ? "Edit language" : "Add a language";
    langName.value = entry ? entry.title : "";
    langText.value = entry ? entry.text : "";
    languageError.hidden = true;
    languageForm.showPopover();
    langName.focus();
  }

  languageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = tabById(bank.tabId);
    if (!tab) return;
    const title = langName.value.trim();
    const text = langText.value.trim();
    if (!title || !text) {
      languageError.textContent = !title ? "Enter what this language bank is for." : "Write the language to save.";
      languageError.hidden = false;
      return;
    }
    if (bank.editing) Object.assign(bank.editing, { title, text });
    else bank.items.unshift({ id: bank.nextId++, clientId: tab.id, title, text });
    bank.editing = null;
    languageForm.hidePopover();
    renderLanguages();
  });

  $("addLanguageButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === bank.activeId) || state.tabs[0];
    if (tab) openLanguageForm(tab, null);
  });
  // Client names, Active status and tabs change in Consultations, so the subtabs are drawn again whenever this tab is opened.
  $("research-tab-language").addEventListener("change", renderLanguages);

  /* ---------- Keyword Research (Research & Ideation Support) ---------- */

  // [key, title, how many text fields, label for each field]
  const KW_GROUPS = [["synonyms", "Synonyms", 8, "Synonym"], ["longtail", "Long-tail keywords", 10, "Long-tail keyword"], ["questions", "Questions", 8, "Question"]];
  const keywordBlank = $("keywordBlank");
  const keywordTabset = $("keywordTabset");
  const keywordRail = $("keywordRail");
  const keywordHost = $("keywordPane");
  const keywordForm = $("keywordFormPopup");
  const keywordView = $("keywordViewPopup");
  const keywordError = $("keywordError");
  const kwTitle = $("kw-title");
  const kwPrimary = $("kw-primary");
  const kw = { items: [], nextId: 1, editing: null, tabId: null, activeId: null };
  const kwInputs = {};

  // The text fields are made once: 8 synonyms, 10 long-tail keywords, 8 questions.
  KW_GROUPS.forEach(([key, , count, label]) => {
    const host = $(`kw-${key}`);
    kwInputs[key] = [];
    for (let i = 0; i < count; i++) {
      // Synonyms stay short text fields; Long-tail keywords and Questions are paragraph fields.
      const paragraph = key !== "synonyms";
      const input = el(paragraph ? "textarea" : "input");
      if (paragraph) {
        input.rows = 3;
        input.maxLength = 2000;
      } else {
        input.type = "text";
        input.maxLength = 200;
      }
      input.placeholder = `${label} ${i + 1}`;
      input.setAttribute("aria-label", `${label} ${i + 1}`);
      host.appendChild(input);
      kwInputs[key].push(input);
    }
  });

  // What the Copy button puts on the clipboard: the primary keyword and the three lists, without the client.
  function keywordText(entry) {
    const lines = [`Primary keyword: ${entry.primary}`];
    KW_GROUPS.forEach(([key, title]) => {
      if (entry[key].length) lines.push("", `${title}:`, ...entry[key].map((item) => `- ${item}`));
    });
    return lines.join("\n");
  }

  function openKeywordView(entry) {
    $("keywordViewTitle").textContent = entryClient(entry);
    const body = $("keywordViewBody");
    body.replaceChildren();
    const sections = [["Primary keyword", entry.primary]].concat(KW_GROUPS.map(([key, title]) => [title, entry[key].join("\n") || "None"]));
    sections.forEach(([label, text]) => {
      const field = el("div", "vm-field");
      field.append(el("span", "vm-label", label), el("p", "vm-text", text));
      body.appendChild(field);
    });
    keywordView.showPopover();
  }

  // Cards work like the Language Bank cards: Copy, View, Edit and Delete.
  function keywordCard(tab, entry) {
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(keywordText(entry), copy));

    const view = iconButton("i-view", "View details");
    view.classList.add("view");
    view.addEventListener("click", () => openKeywordView(entry));

    const body = el("div", "bm-body");
    body.append(el("h3", "", entry.title), el("p", "bm-snippet", entry.primary));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "keywords", id: entry.id }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openKeywordForm(tab, entry));
    del.disabled = edit.disabled = !tab.data.working; // an Inactive client cannot change its keywords

    card.append(copy, view, body, del, edit);
    return card;
  }

  function buildKeywordPane(tab) {
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", clientLabel(tab));
    pane.innerHTML = '<div class="pane-head"><h2 data-title></h2></div><div class="form"><div class="notes-grid" data-items></div></div>'; // static markup only; names are set below as text
    pane.querySelector("[data-title]").textContent = clientLabel(tab);
    const grid = pane.querySelector("[data-items]");
    const items = kw.items.filter((entry) => entry.clientId === tab.id);
    if (!items.length) grid.appendChild(el("p", "empty", "No keywords yet. Use the + Add keywords button to save your first set."));
    else items.forEach((entry) => grid.appendChild(keywordCard(tab, entry)));
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderKeywords() {
    const hasTabs = state.tabs.length > 0;
    keywordBlank.hidden = hasTabs;
    keywordTabset.hidden = !hasTabs;
    $("addKeywordsButton").disabled = !hasTabs;
    keywordRail.replaceChildren();
    keywordHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === kw.activeId) || state.tabs[0];
    kw.activeId = open.id;
    $("addKeywordsButton").disabled = !open.data.working; // an Inactive client cannot get new keywords
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      const name = (tab.data.client || "").trim();
      button.title = name ? `#${tab.number} – ${name}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        kw.activeId = tab.id;
        renderKeywords();
      });
      keywordRail.appendChild(button);
    });
    keywordHost.appendChild(buildKeywordPane(open));
  }

  // Add and edit use the same popup.
  function openKeywordForm(tab, entry) {
    kw.tabId = tab.id;
    kw.editing = entry || null;
    $("keywordFormTitle").textContent = entry ? "Edit keywords" : "Add keywords";
    kwTitle.value = entry ? entry.title : "";
    kwPrimary.value = entry ? entry.primary : "";
    KW_GROUPS.forEach(([key]) => kwInputs[key].forEach((input, i) => { input.value = entry ? entry[key][i] || "" : ""; }));
    keywordError.hidden = true;
    keywordForm.showPopover();
    kwTitle.focus();
  }

  keywordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = tabById(kw.tabId);
    if (!tab) return;
    const title = kwTitle.value.trim();
    const primary = kwPrimary.value.trim();
    if (!title || !primary) {
      keywordError.textContent = !title ? "Enter what this primary keyword is for." : "Write the primary keyword.";
      keywordError.hidden = false;
      return;
    }
    const values = { clientId: tab.id, clientName: clientLabel(tab), title, primary };
    KW_GROUPS.forEach(([key]) => { values[key] = kwInputs[key].map((input) => input.value.trim()).filter(Boolean); });
    if (kw.editing) Object.assign(kw.editing, values);
    else kw.items.unshift({ id: kw.nextId++, ...values });
    kw.editing = null;
    keywordForm.hidePopover();
    renderKeywords();
  });

  $("addKeywordsButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === kw.activeId) || state.tabs[0];
    if (tab) openKeywordForm(tab, null);
  });
  // Client names, Active status and tabs change in Consultations, so the subtabs are drawn again whenever this tab is opened.
  $("research-tab-keywords").addEventListener("change", renderKeywords);

  /* ---------- Competition Analysis (Research & Ideation Support) ---------- */

  // Base URL of the Cloudflare Worker that asks gemini-3.5-flash-lite to analyze a competitor.
  // While it is empty, a sample analysis is shown so the three states can be previewed.
  const ANALYSIS_API = "";
  const comp = { activeId: null, busy: null, nextId: 1 };
  const compBlank = $("competitionBlank");
  const compTabset = $("competitionTabset");
  const compRail = $("competitionRail");
  const compHost = $("competitionPane");
  const analysisView = $("analysisViewPopup");

  const compClient = (tab) => (tab.data.client || "").trim();
  const compTemplates = () => ismco.items.filter((item) => item.applies === "competition");
  const compTemplate = (tab) => compTemplates().find((item) => item.id === tab.comp.templateId) || null;

  // Everything the analysis depends on. If it changes after an analysis, the competitor needs analyzing again.
  function compSignature(tab) {
    const template = compTemplate(tab);
    return JSON.stringify({
      competitors: tab.comp.competitors.map((item) => item.name.trim()).filter(Boolean),
      notes: tab.comp.notes.map((note) => [note.title, note.text, note.competitorId]),
      template: template ? [template.id, template.updated] : null
    });
  }

  // "November 8, 2026, at 9:31 PM UTC"
  function fmtUtc(iso) {
    const d = new Date(iso);
    const hour = d.getUTCHours();
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, at ${hour % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"} UTC`;
  }

  // The AI answers in markdown; it is shown as simple, safe formatting (headings, bold, lists).
  function inlineMarkdown(parent, text) {
    const pattern = /(\*\*(.+?)\*\*|`([^`]+)`|\*(?!\s)(.+?)\*)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      if (match[2] !== undefined) parent.appendChild(el("strong", "", match[2]));
      else if (match[3] !== undefined) parent.appendChild(el("code", "", match[3]));
      else parent.appendChild(el("em", "", match[4]));
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function renderMarkdown(root, text) {
    root.replaceChildren();
    let paragraph = [];
    let list = null;
    let listType = "";
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = el("p");
      inlineMarkdown(p, paragraph.join(" "));
      root.appendChild(p);
      paragraph = [];
    };
    const flushList = () => { list = null; listType = ""; };
    const addItem = (type, content) => {
      flushParagraph();
      if (!list || listType !== type) {
        list = el(type);
        listType = type;
        root.appendChild(list);
      }
      const li = el("li");
      inlineMarkdown(li, content);
      list.appendChild(li);
    };
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
      let m;
      if (!line.trim()) {
        flushParagraph();
        flushList();
      } else if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) {
        flushParagraph();
        flushList();
        const heading = el(m[1].length <= 2 ? "h3" : "h4");
        inlineMarkdown(heading, m[2]);
        root.appendChild(heading);
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        flushList();
        root.appendChild(el("hr"));
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        addItem("ul", m[1]);
      } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        addItem("ol", m[1]);
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    });
    flushParagraph();
  }

  // A sample analysis, written the way the real one will look, until the Worker is connected.
  function mockAnalysis(payload) {
    const client = payload.client || "your client";
    const names = payload.competitors;
    const lines = [
      `**Competitors reviewed:** ${names.join(", ")}`,
      "",
      "### Summary",
      `${names.length === 1 ? `${names[0]} is` : "These competitors are"} well established in ${client}’s space, with consistent messaging and regular content. The biggest openings for ${client} are in specific, practical content and in a clearer offer.`,
      ""
    ];
    names.forEach((name) => {
      lines.push(
        `### ${name}`,
        "",
        "**Positioning:** A broad, benefit-led offer aimed at a general audience.",
        "",
        "**Strengths**",
        "- Clear, consistent messaging across its website and social channels",
        "- A regular publishing schedule that keeps the brand visible",
        "- Strong calls to action on its main pages",
        "",
        "**Weaknesses**",
        "- Content stays general and rarely answers specific questions",
        "- Little proof of results, such as case studies or testimonials",
        "- Slow to reply to comments and questions from its community",
        "",
        "**Keyword and content focus**",
        "- Targets short, high-competition keywords",
        "- Few long-tail or question-based pages",
        ""
      );
    });
    lines.push(
      `### Opportunities for ${client}`,
      "",
      "1. Publish content that answers the specific questions competitors skip.",
      "2. Show real results with case studies and testimonials.",
      "3. Target long-tail keywords where competition is lower.",
      "4. Reply quickly and personally in the community.",
      "",
      "### Recommended next steps",
      "",
      "- Pick three long-tail keywords and draft one page for each this month.",
      "- Collect two client testimonials to feature on the main offer page.",
      "- Review these competitors again in 90 days to track changes.",
      ""
    );
    if (payload.notes.length) {
      lines.push("### Notes considered", "");
      payload.notes.forEach((note) => {
        const text = note.text.length > 120 ? `${note.text.slice(0, 120)}…` : note.text;
        lines.push(`- **${note.title}**${note.competitor ? ` (${note.competitor})` : ""}: ${text}`);
      });
      lines.push("");
    }
    lines.push("---", "", "*Sample analysis for preview only. The real analysis will come from gemini-3.5-flash-lite.*");
    return lines.join("\n");
  }

  // The Worker answers { analysis, analyzed_at }, with the time taken from the Cloudflare server.
  async function requestAnalysis(payload) {
    if (!ANALYSIS_API) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        analysis: mockAnalysis(payload),
        analyzed_at: new Date().toISOString()
      };
    }
    let response;
    try {
      response = await fetch(`${ANALYSIS_API.replace(/\/+$/, "")}/api/competition/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  // How a competitor is named in lists: its name, or "Competitor #n" while the name is empty.
  function compLabel(tab, item) {
    return item.name.trim() || `Competitor #${tab.comp.competitors.indexOf(item) + 1}`;
  }
  function compOwnerName(tab, note) {
    const item = tab.comp.competitors.find((entry) => entry.id === note.competitorId);
    return item ? compLabel(tab, item) : "";
  }

  function compPaneHTML() {
    return `<div class="pane-head"><h2 data-title></h2><div class="pane-tools"><span class="form-error" data-comperr role="alert" hidden></span><span class="tools-inner" data-tools></span></div></div>
<div class="form">
  <div class="stack" data-competitors></div>
  <section class="block">
    <div class="block-head"><h3>Notes</h3><button class="ic tool" type="button" data-addnote title="Add notes" aria-label="Add notes"><svg aria-hidden="true"><use href="#i-bmadd"/></svg></button></div>
    <div class="notes-grid" data-notes></div>
  </section>
  <label class="f">ISMCO Template<select data-template></select></label>
</div>`;
  }

  // Beside the title: the analyze button, "Inactive", or the link to the finished analysis.
  function paintTools(pane, tab) {
    const tools = pane.querySelector("[data-tools]");
    tools.replaceChildren();
    if (comp.busy === tab.id) {
      tools.appendChild(el("span", "status busy", "Analyzing…"));
      return;
    }
    const done = tab.comp.analysis && tab.comp.analysis.sig === compSignature(tab);
    if (done) {
      const link = el("button", "linkbtn", "analysis");
      link.type = "button";
      link.addEventListener("click", () => openAnalysis(tab));
      const sentence = el("span", "status done");
      sentence.append("The competitor has already been analyzed. You can view the ", link, ".");
      tools.appendChild(sentence);
    } else if (!tab.data.working) {
      tools.appendChild(el("span", "status inactive", "Inactive"));
    } else {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Analyze the competitor";
      button.setAttribute("aria-label", "Analyze the competitor");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-spark"/></svg>'; // static markup only
      button.addEventListener("click", () => runAnalysis(tab, pane));
      tools.append(button, el("span", "status todo", "Analyze the competitor"));
    }
  }

  function paintCompetitors(pane, tab) {
    const host = pane.querySelector("[data-competitors]");
    host.replaceChildren();
    if (!tab.comp.competitors.length) {
      host.appendChild(el("p", "sub", "No competitors yet. Use the + Add competitors button to add one."));
      return;
    }
    tab.comp.competitors.forEach((item, index) => {
      const row = el("div", "crow");

      // Lock / Unlock on the left of the field: a locked competitor can only be edited or deleted after it is unlocked.
      const lock = el("button", "ic tool");
      lock.type = "button";
      lock.title = item.locked ? "Unlock competitor" : "Lock competitor";
      lock.setAttribute("aria-label", lock.title);
      lock.innerHTML = `<svg aria-hidden="true"><use href="#${item.locked ? "i-lock" : "i-unlock"}"/></svg>`; // static markup only
      // An Inactive client cannot lock or unlock its competitors.
      lock.disabled = !tab.data.working;
      if (lock.disabled) lock.title = "This client is Inactive";
      lock.addEventListener("click", () => {
        item.locked = !item.locked;
        paintCompetitors(pane, tab);
        if (!item.locked) host.querySelectorAll("input")[index].focus();
      });

      const label = el("label", "f", `Competitor #${index + 1}`);
      const input = el("input");
      input.type = "text";
      input.maxLength = 500;
      input.autocomplete = "off";
      input.value = item.name;
      input.readOnly = item.locked;
      input.addEventListener("input", () => {
        item.name = input.value;
        pane.querySelector("[data-comperr]").hidden = true;
        paintTools(pane, tab);
      });
      label.appendChild(input);

      // Delete on the right of the field, available once the competitor is unlocked.
      const del = el("button", "ic tool danger");
      del.type = "button";
      del.title = item.locked ? "Unlock to delete this competitor" : "Delete competitor";
      del.setAttribute("aria-label", "Delete competitor");
      del.disabled = item.locked;
      del.setAttribute("popovertarget", "deleteTabPopup");
      del.innerHTML = '<svg aria-hidden="true"><use href="#i-del"/></svg>'; // static markup only
      del.addEventListener("click", () => { state.deleting = { kind: "competitor", tabId: tab.id, competitorId: item.id }; });

      row.append(lock, label, del);
      host.appendChild(row);
    });
  }

  // The ISMCO templates whose "Applies to" is Competition Analysis.
  function paintTemplates(pane, tab) {
    const select = pane.querySelector("[data-template]");
    select.replaceChildren();
    const list = compTemplates();
    if (!list.length) {
      const none = el("option", "", "No ISMCO template applies to Competition Analysis yet");
      none.value = "";
      select.appendChild(none);
      tab.comp.templateId = null;
    } else {
      list.forEach((item) => {
        const option = el("option", "", item.title);
        option.value = String(item.id);
        select.appendChild(option);
      });
      if (!list.some((item) => item.id === tab.comp.templateId)) tab.comp.templateId = list[0].id;
      select.value = String(tab.comp.templateId);
    }
    select.addEventListener("change", () => {
      tab.comp.templateId = Number(select.value) || null;
      paintTools(pane, tab);
    });
  }

  async function runAnalysis(tab, pane) {
    const error = pane.querySelector("[data-comperr]");
    const competitors = tab.comp.competitors.map((item) => item.name.trim()).filter(Boolean);
    const template = compTemplate(tab);
    if (!competitors.length || !template) {
      error.textContent = !competitors.length
        ? "Add at least one competitor first."
        : "Choose an ISMCO template first. Add one in ISMCO and set Applies to Competition Analysis.";
      error.hidden = false;
      return;
    }
    error.hidden = true;
    comp.busy = tab.id;
    paintTools(pane, tab);

    const sig = compSignature(tab);
    let message = "";
    try {
      const result = await requestAnalysis({
        client: compClient(tab),
        competitors,
        notes: tab.comp.notes.map((note) => ({ title: note.title, text: note.text, competitor: compOwnerName(tab, note) })),
        template: { title: template.title, intent: template.intent, scope: template.scope, method: template.method, constraints: template.constraints, output: template.output }
      });
      tab.comp.analysis = { text: result.analysis, at: result.analyzed_at, sig };
    } catch (failure) {
      message = failure.message;
    }
    comp.busy = null;
    renderCompetition();
    const shown = compHost.querySelector("[data-comperr]");
    if (message && shown && comp.activeId === tab.id) {
      shown.textContent = message;
      shown.hidden = false;
    }
  }

  function openAnalysis(tab) {
    $("analysisViewTitle").textContent = compClient(tab) ? `Competitor analysis for ${compClient(tab)}` : "Competitor analysis";
    $("analysisViewWhen").textContent = `Last analyzed on ${fmtUtc(tab.comp.analysis.at)}`;
    renderMarkdown($("analysisViewText"), tab.comp.analysis.text);
    analysisView.showPopover();
  }

  function buildCompPane(tab) {
    const name = compClient(tab);
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", name || `#${tab.number}`);
    pane.innerHTML = compPaneHTML(); // static markup only; names are set below as text, never as HTML
    pane.querySelector("[data-title]").textContent = name || `#${tab.number}`;
    paintCompetitors(pane, tab);
    renderNotes(pane, tab, "comp");
    const addNote = pane.querySelector("[data-addnote]");
    addNote.disabled = !tab.data.working;
    if (addNote.disabled) addNote.title = "This client is Inactive";
    addNote.addEventListener("click", () => openNoteForm(tab, null, "comp"));
    paintTemplates(pane, tab);
    paintTools(pane, tab);
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderCompetition() {
    const hasTabs = state.tabs.length > 0;
    compBlank.hidden = hasTabs;
    compTabset.hidden = !hasTabs;
    $("addCompetitorsButton").disabled = !hasTabs;
    compRail.replaceChildren();
    compHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === comp.activeId) || state.tabs[0];
    comp.activeId = open.id;
    // An Inactive client cannot get new competitors; the same goes for notes (see buildCompPane).
    $("addCompetitorsButton").disabled = !open.data.working;
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      button.title = compClient(tab) ? `#${tab.number} – ${compClient(tab)}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        comp.activeId = tab.id;
        renderCompetition();
      });
      compRail.appendChild(button);
    });
    compHost.appendChild(buildCompPane(open));
  }

  // "+ Add competitors" adds the next Competitor field to the open subtab.
  $("addCompetitorsButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === comp.activeId) || state.tabs[0];
    if (!tab) return;
    tab.comp.competitors.push({ id: comp.nextId++, name: "", locked: false });
    renderCompetition();
    const inputs = compHost.querySelectorAll("[data-competitors] input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  // Client names, Active status and templates can change elsewhere, so the subtabs are drawn again whenever this tab is opened.
  $("research-tab-competition").addEventListener("change", renderCompetition);

  /* ---------- Research Notes (Research & Ideation Support) ---------- */

  // These notes belong to no client, and use the same note popup as Consultations.
  const research = { items: [] };
  const researchGrid = $("researchNotesGrid");

  function renderResearchNotes() {
    researchGrid.replaceChildren();
    if (!research.items.length) {
      researchGrid.appendChild(el("p", "empty", "No notes yet. Choose + Add notes to save your first one."));
      return;
    }
    research.items.forEach((note) => researchGrid.appendChild(noteCard(null, note, "research")));
  }

  $("addResearchNotesButton").addEventListener("click", () => openNoteForm(null, null, "research"));

  /* ---------- Words and Phrases to Avoid (Content & Editorial) ---------- */

  // Cards work like the Research Notes cards: Copy, View, Edit and Delete.
  const avoid = { items: [], nextId: 1, editing: null };
  const avoidGrid = $("avoidGrid");
  const avoidForm = $("avoidFormPopup");
  const avoidView = $("avoidViewPopup");
  const avoidError = $("avoidError");

  function renderAvoid() {
    avoidGrid.replaceChildren();
    if (!avoid.items.length) {
      avoidGrid.appendChild(el("p", "empty", "No words and phrases yet. Use the Add words and phrases button to save your first list."));
      return;
    }
    avoid.items.forEach((item) => {
      const card = el("div", "bm");

      const copy = el("button", "mini copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(item.text, copy));

      const view = iconButton("i-view", "View details");
      view.classList.add("view");
      view.addEventListener("click", () => {
        $("avoidViewTitle").textContent = item.title;
        $("avoidViewText").textContent = item.text;
        avoidView.showPopover();
      });

      const body = el("div", "bm-body");
      body.append(el("h3", "", item.title), el("p", "bm-snippet", item.text));

      const del = el("button", "mini del", "Delete");
      del.type = "button";
      del.setAttribute("popovertarget", "deleteTabPopup");
      del.addEventListener("click", () => { state.deleting = { kind: "avoid", id: item.id }; });

      const edit = el("button", "mini edit", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openAvoidForm(item));

      card.append(copy, view, body, del, edit);
      avoidGrid.appendChild(card);
    });
  }

  // Add and edit use the same popup.
  function openAvoidForm(item) {
    avoid.editing = item || null;
    $("avoidFormTitle").textContent = item ? "Edit words and phrases to avoid" : "Add words and phrases to avoid";
    $("avoidName").value = item ? item.title : "";
    $("avoidText").value = item ? item.text : "";
    avoidError.hidden = true;
    avoidForm.showPopover();
    $("avoidName").focus();
  }

  avoidForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("avoidName").value.trim();
    const text = $("avoidText").value.trim();
    if (!title || !text) {
      avoidError.textContent = !title ? "Enter what this list is for." : "Write the words and phrases to avoid.";
      avoidError.hidden = false;
      return;
    }
    if (avoid.editing) Object.assign(avoid.editing, { title, text });
    else avoid.items.push({ id: avoid.nextId++, title, text });
    avoid.editing = null;
    avoidForm.hidePopover();
    renderAvoid();
  });

  $("addAvoidButton").addEventListener("click", () => openAvoidForm(null));

  /* ---------- Content (Content & Editorial) ---------- */

  // Base URL of the Cloudflare Worker that asks gemini-3.5-flash-lite to write the content.
  // While it is empty, sample content is shown so the three states can be previewed.
  const CONTENT_API = "";
  const cont = { activeId: null, busy: null, nextId: 1, editing: null, confirming: null, draft: null };
  const EDIT_PHRASE = "EDIT";
  const contBlank = $("contentBlank");
  const contTabset = $("contentTabset");
  const contRail = $("contentRail");
  const contHost = $("contentPane");
  const contentForm = $("contentFormPopup");
  const contentItemView = $("contentItemViewPopup");
  const contentError = $("contentFormError");

  // Each client tab holds its own content items: { id, title, kind, kwId, langId, noteId, templateId, written: { text, at, sig } | null }
  function contOf(tab) { return tab.content || (tab.content = { items: [] }); }
  const contTemplates = () => ismco.items.filter((item) => item.applies === "content");
  const snip = (text, max = 70) => (text.length > max ? `${text.slice(0, max)}…` : text);

  // The saved pieces the content is based on. A piece that was deleted elsewhere comes back as null.
  function itemParts(item) {
    return {
      keyword: kw.items.find((entry) => entry.id === item.kwId) || null,
      language: bank.items.find((entry) => entry.id === item.langId) || null,
      note: research.items.find((entry) => entry.id === item.noteId) || null,
      template: ismco.items.find((entry) => entry.id === item.templateId) || null
    };
  }

  // Everything the content depends on. If it changes after the content was written, it needs writing again.
  function itemSig(item) {
    const p = itemParts(item);
    return JSON.stringify({
      kind: item.kind,
      keyword: p.keyword ? [p.keyword.primary, p.keyword.synonyms, p.keyword.longtail, p.keyword.questions] : null,
      language: p.language ? p.language.text : null,
      note: p.note ? [p.note.title, p.note.text] : null,
      template: p.template ? [p.template.id, p.template.updated] : null
    });
  }
  
  // The written content is plain text: any markdown the AI returns is stripped before it is saved.
  function plainText(text) {
    return String(text || "").replace(/\r\n?/g, "\n")
      .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "- ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(?!\s)(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // A sample piece of content, written the way the real one will look, until the Worker is connected.
  function mockContent(p) {
    const lines = [
      `${p.kind} for ${p.client || "your client"}, built around the primary keyword “${p.primary}”.`,
      "",
      `Start with a clear, friendly opening that speaks to the reader’s biggest question about ${p.primary}. Then explain the answer in plain words and give one practical example they can use today.`,
      ""
    ];
    if (p.longtail.length) lines.push("Keywords to work in:", ...p.longtail.slice(0, 3).map((item) => `- ${item}`), "");
    if (p.questions.length) lines.push("Questions to answer:", ...p.questions.slice(0, 3).map((item) => `- ${item}`), "");
    lines.push("Sample content for preview only. The real content will come from gemini-3.5-flash-lite.");
    return lines.join("\n");
  }

  // The Worker answers { content, written_at }, with the time taken from the Cloudflare server.
  async function requestContent(payload) {
    if (!CONTENT_API) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { content: mockContent(payload), written_at: new Date().toISOString() };
    }
    let response;
    try {
      response = await fetch(`${CONTENT_API.replace(/\/+$/, "")}/api/content/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  /* Cards: the same buttons as the Competition Analysis cards (Copy, View, Edit, Delete). */
  function contentCard(tab, item) {
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(item.written ? item.written.text : item.title, copy));

    const view = iconButton("i-view", "View details");
    view.classList.add("view");
    view.addEventListener("click", () => openContentItem(item));

    const body = el("div", "bm-body");
    body.append(el("h3", "", item.title), el("p", "bm-for", `Kind: ${item.kind}`), el("p", "bm-snippet", item.written ? item.written.text.replace(/[#*`]/g, "") : "Not written yet."));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "contentitem", tabId: tab.id, itemId: item.id }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.setAttribute("popovertarget", "editContentPopup");
    edit.addEventListener("click", () => { cont.confirming = { tabId: tab.id, itemId: item.id }; }); // the form opens after EDIT is typed
    del.disabled = edit.disabled = !tab.data.working; // an Inactive client cannot change its content

    card.append(copy, view, body, del, edit);
    return card;
  }

  function openContentItem(item) {
    const p = itemParts(item);
    $("contentItemViewTitle").textContent = item.title;
    const body = $("contentItemViewBody");
    body.replaceChildren();
    const none = (list) => (list && list.length ? list.join("\n") : "None");
    const sections = [
      ["What kind of content?", item.kind],
      ["Primary keyword", p.keyword ? p.keyword.primary : "None"],
      ["Synonyms", p.keyword ? none(p.keyword.synonyms) : "None"],
      ["Long-tail keywords", p.keyword ? none(p.keyword.longtail) : "None"],
      ["Questions", p.keyword ? none(p.keyword.questions) : "None"],
      ["Language bank", p.language ? p.language.text : "None"],
      ["Research notes", p.note ? `${p.note.title}\n${p.note.text}` : "None"],
      ["ISMCO Template", p.template ? p.template.title : "None"]
    ];
    if (item.written) sections.push(["Written content", item.written.text]);
    sections.forEach(([label, text]) => {
      const field = el("div", "vm-field");
      field.append(el("span", "vm-label", label), el("p", "vm-text", text));
      body.appendChild(field);
    });
    contentItemView.showPopover();
  }

  /* Add and edit use the same popup. */
  function setOptions(select, rows, current, noneLabel, alwaysNone) {
    select.replaceChildren();
    if (alwaysNone || !rows.length) {
      const none = el("option", "", noneLabel);
      none.value = "";
      select.appendChild(none);
    }
    rows.forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = String(value);
      select.appendChild(option);
    });
    select.value = current ? String(current) : select.options[0].value;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
  }

  // Synonyms, Long-tail keywords, Questions and the Language bank text follow the selected dropdowns.
  function syncContentForm() {
    const entry = kw.items.find((item) => item.id === Number($("cf-kw").value));
    ["synonyms", "longtail", "questions"].forEach((key) => { $(`cf-${key}`).value = entry ? entry[key].join("\n") : ""; });
    const language = bank.items.find((item) => item.id === Number($("cf-lang").value));
    $("cf-langtext").value = language ? language.text : "";
  }
  $("cf-kw").addEventListener("change", syncContentForm);
  $("cf-lang").addEventListener("change", syncContentForm);

  function openContentForm(tab, item) {
    cont.editing = { tabId: tab.id, item: item || null };
    $("contentFormTitle").textContent = item ? "Edit content" : "Add content";
    $("cf-title").value = item ? item.title : "";
    $("cf-kind").value = item ? item.kind : "";
    setOptions($("cf-kw"), kw.items.filter((entry) => entry.clientId === tab.id).map((entry) => [entry.id, entry.primary]), item && item.kwId, "No primary keywords for this client yet", false);
    setOptions($("cf-lang"), bank.items.filter((entry) => entry.clientId === tab.id).map((entry) => [entry.id, entry.title]), item && item.langId, "None", true);
    setOptions($("cf-note"), research.items.map((note) => [note.id, note.title]), item && item.noteId, "None", true);
    setOptions($("cf-template"), contTemplates().map((template) => [template.id, template.title]), item && item.templateId, "No ISMCO template applies to Content & Editorial yet", false);
    cont.draft = item && item.written ? { ...item.written } : null;
    cont.busy = false;
    $("cf-writeerr").hidden = true;
    syncContentForm();
    paintFormTools();
    contentError.hidden = true;
    contentForm.showPopover();
    $("cf-title").focus();
  }

  contentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const editing = cont.editing;
    const tab = editing ? tabById(editing.tabId) : null;
    if (!tab) return;
    const title = $("cf-title").value.trim();
    const kind = $("cf-kind").value.trim();
    const kwId = Number($("cf-kw").value) || null;
    if (!title || !kind || !kwId) {
      contentError.textContent = !title ? "Enter what this content is." : !kind ? "Enter what kind of content this is." : "Choose a primary keyword. Add one in Keyword Research first.";
      contentError.hidden = false;
      return;
    }
    const values = { title, kind, kwId, langId: Number($("cf-lang").value) || null, noteId: Number($("cf-note").value) || null, templateId: Number($("cf-template").value) || null, written: cont.draft };
    if (editing.item) Object.assign(editing.item, values);
    else contOf(tab).items.push({ id: cont.nextId++, written: null, ...values });
    cont.editing = null;
    cont.draft = null;
    contentForm.hidePopover();
    renderContent();
  });

  /* Inside the popup, after the ISMCO Template: the write button, "Inactive", or the link to the finished content.
     The written content is held in cont.draft and saved with the Save button. */
  function formItem() {
    return { kind: $("cf-kind").value.trim(), kwId: Number($("cf-kw").value) || null, langId: Number($("cf-lang").value) || null, noteId: Number($("cf-note").value) || null, templateId: Number($("cf-template").value) || null };
  }

  function paintFormTools() {
    const tab = cont.editing ? tabById(cont.editing.tabId) : null;
    if (!tab) return;
    const tools = $("cf-tools");
    tools.replaceChildren();
    $("cf-written").value = cont.draft ? cont.draft.text : "";
    if (cont.busy) {
      tools.appendChild(el("span", "status busy", "Writing…"));
    } else if (cont.draft && cont.draft.sig === itemSig(formItem())) {
      tools.appendChild(el("span", "status done", "The content has already been written. You can view the content."));
    } else if (!tab.data.working) {
      tools.appendChild(el("span", "status inactive", "Inactive"));
    } else {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Write this content";
      button.setAttribute("aria-label", "Write this content");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-spark"/></svg>'; // static markup only
      button.addEventListener("click", writeFromForm);
      tools.append(button, el("span", "status todo", "Write this content"));
    }
  }

  async function writeFromForm() {
    const tab = cont.editing ? tabById(cont.editing.tabId) : null;
    if (!tab) return;
    const error = $("cf-writeerr");
    const item = formItem();
    const p = itemParts(item);
    const problem = !item.kind ? "Enter what kind of content this is first."
      : !p.keyword ? "Choose a primary keyword first."
        : !p.template ? "Choose an ISMCO template first. Add one in ISMCO and set Applies to Content & Editorial." : "";
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    cont.busy = true;
    paintFormTools();

    const sig = itemSig(item);
    let message = "";
    try {
      const result = await requestContent({
        client: compClient(tab),
        title: $("cf-title").value.trim(),
        kind: item.kind,
        format: "plain text",
        primary: p.keyword.primary,
        synonyms: p.keyword.synonyms,
        longtail: p.keyword.longtail,
        questions: p.keyword.questions,
        language: p.language ? p.language.text : "",
        research: p.note ? { title: p.note.title, text: p.note.text } : null,
        template: { title: p.template.title, intent: p.template.intent, scope: p.template.scope, method: p.template.method, constraints: p.template.constraints, output: p.template.output }
      });
      if (cont.editing) cont.draft = { text: plainText(result.content), at: result.written_at, sig };
    } catch (failure) {
      message = failure.message;
    }
    cont.busy = false;
    if (!cont.editing) return; // the popup was closed while the content was being written
    paintFormTools();
    if (message) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  // Changing any of these makes the written content out of date, so the button comes back.
  $("cf-kind").addEventListener("input", paintFormTools);
  ["cf-kw", "cf-lang", "cf-note", "cf-template"].forEach((id) => $(id).addEventListener("change", paintFormTools));

  function buildContentPane(tab) {
    const name = compClient(tab);
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", name || `#${tab.number}`);
    pane.innerHTML = '<div class="pane-head"><h2 data-title></h2></div><div class="form"><div class="notes-grid" data-items></div></div>'; // static markup only; names are set below as text
    pane.querySelector("[data-title]").textContent = name || `#${tab.number}`;
    const grid = pane.querySelector("[data-items]");
    const items = contOf(tab).items;
    if (!items.length) grid.appendChild(el("p", "empty", "No content yet. Use the + Add content button to add one."));
    else items.forEach((item) => grid.appendChild(contentCard(tab, item)));
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderContent() {
    const hasTabs = state.tabs.length > 0;
    contBlank.hidden = hasTabs;
    contTabset.hidden = !hasTabs;
    $("addContentButton").disabled = !hasTabs;
    contRail.replaceChildren();
    contHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === cont.activeId) || state.tabs[0];
    cont.activeId = open.id;
    $("addContentButton").disabled = !open.data.working; // an Inactive client cannot get new content
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      button.title = compClient(tab) ? `#${tab.number} – ${compClient(tab)}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        cont.activeId = tab.id;
        renderContent();
      });
      contRail.appendChild(button);
    });
    contHost.appendChild(buildContentPane(open));
  }

  /* Edit security check: the Edit button stays disabled until EDIT is typed exactly. */
  const editPopup = $("editContentPopup");
  const editPhrase = $("editContentPhrase");
  const editConfirm = $("editContentConfirm");
  editPhrase.addEventListener("input", () => { editConfirm.disabled = editPhrase.value !== EDIT_PHRASE; });
  editPopup.addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    editPhrase.value = "";
    editConfirm.disabled = true;
    editPhrase.focus();
  });
  editConfirm.addEventListener("click", () => {
    const target = cont.confirming;
    const tab = target ? tabById(target.tabId) : null;
    const item = tab ? contOf(tab).items.find((entry) => entry.id === target.itemId) : null;
    if (editPhrase.value !== EDIT_PHRASE || !item) return;
    cont.confirming = null;
    editPopup.hidePopover();
    openContentForm(tab, item);
  });

  $("addContentButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === cont.activeId) || state.tabs[0];
    if (tab) openContentForm(tab, null);
  });
  // Client names, keywords, languages, notes and templates change elsewhere, so the subtabs are drawn again
  // whenever this tab is opened, or the Content & Editorial section is opened from the sidebar.
  $("content-tab-content").addEventListener("change", renderContent);
  window.addEventListener("hashchange", () => { if (location.hash === "#content") renderContent(); });

  /* ---------- Community Management & Engagement ---------- */

  // Base URL of the Cloudflare Worker that asks gemini-3.5-flash-lite to generate a reply.
  // While it is empty, a sample reply is shown so the three states can be previewed.
  const COMMUNITY_API = "";
  const comm = { activeId: null, editing: null, draft: null, viewing: null, busy: null, nextId: 1, nextAud: 1, nextTurn: 1 };
  const commBlank = $("communityBlank");
  const commTabset = $("communityTabset");
  const commRail = $("communityRail");
  const commHost = $("communityPane");
  const postForm = $("postFormPopup");
  const postView = $("postViewPopup");
  const threadPopup = $("threadPopup");
  const postError = $("postError");

  // Each client tab holds its own posts: { id, title, caption, langId, noteId, templateId, audiences: [...] }
  // Each audience: { id, name, nameLocked, locked, turns: [{ id, text, reply: { text, at, sig } | null }] }
  // The first turn is the Comment; every later turn is an Audience reply.
  function commOf(tab) { return tab.posts || (tab.posts = { items: [] }); }

  // The Worker answers { reply, generated_at }, with the time taken from the Cloudflare server.
  async function requestReply(payload) {
    if (!COMMUNITY_API) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        reply: `Thank you for your ${payload.thread.length ? "reply" : "comment"}${payload.audience ? `, ${payload.audience}` : ""}! We’re glad it caught your eye. Let us know if there’s anything else we can help with.\n\nSample reply for preview only. The real reply will come from gemini-3.5-flash-lite.`,
        generated_at: new Date().toISOString()
      };
    }
    let response;
    try {
      response = await fetch(`${COMMUNITY_API.replace(/\/+$/, "")}/api/community/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  /* Cards: Copy, View, Edit and Delete, like the Content cards. */
  function postCard(tab, item) {
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(item.caption, copy));

    const view = iconButton("i-view", "View details");
    view.classList.add("view");
    view.addEventListener("click", () => openPostView(item));

    const body = el("div", "bm-body");
    body.append(el("h3", "", item.title), el("p", "bm-snippet", item.caption));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "post", tabId: tab.id, itemId: item.id }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openPostForm(tab, item));
    del.disabled = edit.disabled = !tab.data.working; // an Inactive client cannot change its posts

    card.append(copy, view, body, del, edit);
    return card;
  }

  // The audience thread as plain text: each comment or audience reply, followed by its generated reply.
  function threadText(aud) {
    if (!aud.turns.length) return "No thread yet.";
    const lines = [];
    aud.turns.forEach((turn, index) => {
      lines.push(`${index === 0 ? "Comment" : "Audience reply"}: ${turn.text}`);
      if (turn.reply) lines.push(`Generated reply: ${turn.reply.text}`);
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  function openPostView(item) {
    $("postViewTitle").textContent = item.title;
    const body = $("postViewBody");
    body.replaceChildren();
    const language = bank.items.find((entry) => entry.id === item.langId);
    const note = research.items.find((entry) => entry.id === item.noteId);
    const template = ismco.items.find((entry) => entry.id === item.templateId);
    [
      ["Caption", item.caption],
      ["Audience", null],
      ["Language bank", language ? language.text : "None"],
      ["Research notes", note ? `${note.title}\n${note.text}` : "None"],
      ["ISMCO Template", template ? template.title : "None"]
    ].forEach(([label, text]) => {
      const field = el("div", "vm-field");
      field.appendChild(el("span", "vm-label", label));
      if (label === "Audience") {
        // Each audience name has the View audience thread button on its left.
        if (!item.audiences.length) field.appendChild(el("p", "vm-text", "None"));
        item.audiences.forEach((aud, index) => {
          const name = aud.name.trim() || `Audience #${index + 1}`;
          const row = el("div", "aud-row");
          const view = el("button", "ic tool");
          view.type = "button";
          view.title = "View audience thread";
          view.setAttribute("aria-label", "View audience thread");
          view.innerHTML = '<svg aria-hidden="true"><use href="#i-view"/></svg>'; // static markup only
          view.addEventListener("click", () => {
            $("threadTextTitle").textContent = name;
            $("threadTextBody").textContent = threadText(aud);
            $("threadTextPopup").showPopover();
          });
          row.append(view, el("p", "vm-text", name));
          field.appendChild(row);
        });
      } else {
        field.appendChild(el("p", "vm-text", text));
      }
      body.appendChild(field);
    });
    postView.showPopover();
  }

  /* Add and edit use the same popup. Audiences are edited on a copy that is kept when Save is chosen. */
  function syncPostForm() {
    const language = bank.items.find((item) => item.id === Number($("cp-lang").value));
    $("cp-langtext").value = language ? language.text : "";
  }
  $("cp-lang").addEventListener("change", syncPostForm);

  // The caption is the written content of the selected post.
  function syncPostCaption() {
    const tab = comm.editing ? tabById(comm.editing.tabId) : null;
    const content = tab ? contOf(tab).items.find((entry) => entry.id === Number($("cp-title").value)) : null;
    $("cp-caption").value = content ? (content.written ? content.written.text : "") : (comm.editing && comm.editing.item ? comm.editing.item.caption : "");
  }
  $("cp-title").addEventListener("change", syncPostCaption);

  function openPostForm(tab, item) {
    comm.editing = { tabId: tab.id, item: item || null };
    comm.draft = { audiences: item ? JSON.parse(JSON.stringify(item.audiences)) : [], titleLocked: Boolean(item && item.titleLocked) };
    comm.viewing = null;
    $("postFormTitle").textContent = item ? "Edit post" : "Add post";
    // The post is one of this client's items in Content & Editorial; the caption follows it.
    const contentRows = contOf(tab).items.map((entry) => [entry.id, entry.title]);
    if (item && item.contentId && !contOf(tab).items.some((entry) => entry.id === item.contentId)) contentRows.push([item.contentId, `${item.title} (content deleted)`]);
    setOptions($("cp-title"), contentRows, item && item.contentId, "No content for this client yet. Add one in Content & Editorial first.", false);
    syncPostCaption();
    setOptions($("cp-lang"), bank.items.filter((entry) => entry.clientId === tab.id).map((entry) => [entry.id, entry.title]), item && item.langId, "None", true);
    setOptions($("cp-note"), research.items.map((note) => [note.id, note.title]), item && item.noteId, "None", true);
    setOptions($("cp-template"), ismco.items.filter((entry) => entry.applies === "community").map((entry) => [entry.id, entry.title]), item && item.templateId, "No ISMCO template applies to Community Management & Engagement yet", false);
    syncPostForm();
    paintPostLocks();
    paintAudiences();
    postError.hidden = true;
    postForm.showPopover();
    $("cp-title").focus();
  }

  // Post and Caption each have a lock / unlock button on the right: a locked field cannot be edited.
  const POST_LOCKS = [["title", "cp-title", "cp-lock-title", "post"]];
  function paintPostLocks() {
    POST_LOCKS.forEach(([key, fieldId, buttonId, name]) => {
      const locked = comm.draft[`${key}Locked`];
      $(fieldId).disabled = locked;
      const button = $(buttonId);
      button.innerHTML = `<svg aria-hidden="true"><use href="#${locked ? "i-lock" : "i-unlock"}"/></svg>`; // static markup only
      button.title = locked ? `Unlock ${name}` : `Lock ${name}`;
      button.setAttribute("aria-label", button.title);
    });
  }
  POST_LOCKS.forEach(([key, fieldId, buttonId]) => {
    $(buttonId).addEventListener("click", () => {
      if (!comm.draft) return;
      comm.draft[`${key}Locked`] = !comm.draft[`${key}Locked`];
      paintPostLocks();
      if (!comm.draft[`${key}Locked`]) $(fieldId).focus();
    });
  });

  // Each audience: lock / unlock on the left of the field, the view icon on the right.
  function paintAudiences() {
    const host = $("cp-audiences");
    host.replaceChildren();
    if (!comm.draft.audiences.length) {
      host.appendChild(el("p", "sub", "No audience yet. Use the Add audience button to add one."));
      return;
    }
    comm.draft.audiences.forEach((aud, index) => {
      const row = el("div", "crow");

      const lock = el("button", "ic tool");
      lock.type = "button";
      lock.title = aud.nameLocked ? "Unlock audience" : "Lock audience";
      lock.setAttribute("aria-label", lock.title);
      lock.innerHTML = `<svg aria-hidden="true"><use href="#${aud.nameLocked ? "i-lock" : "i-unlock"}"/></svg>`; // static markup only
      lock.addEventListener("click", () => {
        aud.nameLocked = !aud.nameLocked;
        paintAudiences();
        if (!aud.nameLocked) host.querySelectorAll("input")[index].focus();
      });

      const label = el("label", "f", `Audience #${index + 1}`);
      const input = el("input");
      input.type = "text";
      input.maxLength = 500;
      input.autocomplete = "off";
      input.value = aud.name;
      input.readOnly = aud.nameLocked;
      input.addEventListener("input", () => { aud.name = input.value; });
      label.appendChild(input);

      const view = el("button", "ic tool");
      view.type = "button";
      view.title = "View audience thread";
      view.setAttribute("aria-label", "View audience thread");
      view.innerHTML = '<svg aria-hidden="true"><use href="#i-view"/></svg>'; // static markup only
      view.addEventListener("click", () => openThread(aud));

      row.append(lock, label, view);
      host.appendChild(row);
    });
  }

  $("cp-addaud").addEventListener("click", () => {
    comm.draft.audiences.push({ id: comm.nextAud++, name: "", nameLocked: false, locked: false, turns: [] });
    paintAudiences();
    const inputs = $("cp-audiences").querySelectorAll("input");
    inputs[inputs.length - 1].focus();
  });

  postForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const editing = comm.editing;
    const tab = editing ? tabById(editing.tabId) : null;
    if (!tab) return;
    const contentId = Number($("cp-title").value) || null;
    if (!contentId) {
      postError.textContent = "Choose a post. Add content for this client in Content & Editorial first.";
      postError.hidden = false;
      return;
    }
    const content = contOf(tab).items.find((entry) => entry.id === contentId);
    const title = content ? content.title : editing.item.title;
    const caption = $("cp-caption").value.trim();
    const values = { contentId, title, caption, langId: Number($("cp-lang").value) || null, noteId: Number($("cp-note").value) || null, templateId: Number($("cp-template").value) || null, audiences: comm.draft.audiences, titleLocked: comm.draft.titleLocked };
    if (editing.item) Object.assign(editing.item, values);
    else commOf(tab).items.push({ id: comm.nextId++, ...values });
    comm.editing = null;
    comm.draft = null;
    comm.viewing = null;
    postForm.hidePopover();
    renderCommunity();
  });

  /* ---------- Audience thread popup ---------- */

  function openThread(aud) {
    comm.viewing = aud;
    $("threadError").hidden = true;
    renderThread();
    threadPopup.showPopover();
  }

  // Top left: lock / unlock. When locked, nothing in the popup can be edited (Copy and Close still work).
  $("threadLock").addEventListener("click", () => {
    if (!comm.viewing) return;
    comm.viewing.locked = !comm.viewing.locked;
    renderThread();
  });

  function focusLastTurn() {
    const fields = $("threadBody").querySelectorAll("textarea:not([readonly])");
    if (fields.length) fields[fields.length - 1].focus();
  }

  function newTurn(aud) {
    aud.turns.push({ id: comm.nextTurn++, text: "", reply: null });
    renderThread();
    focusLastTurn();
  }

  function renderThread() {
    const aud = comm.viewing;
    const tab = comm.editing ? tabById(comm.editing.tabId) : null;
    if (!aud || !tab) return;
    const frozen = aud.locked;

    const lock = $("threadLock");
    lock.innerHTML = `<svg aria-hidden="true"><use href="#${frozen ? "i-lock" : "i-unlock"}"/></svg>`; // static markup only
    lock.title = frozen ? "Unlock" : "Lock";
    lock.setAttribute("aria-label", lock.title);

    // "Updated last ...": the time of the newest generated reply, from the Cloudflare server.
    const times = aud.turns.filter((turn) => turn.reply).map((turn) => turn.reply.at).sort();
    $("threadWhen").textContent = times.length ? `Updated last ${fmtUtc(times[times.length - 1])}` : "";

    const body = $("threadBody");
    body.replaceChildren();

    // The audience name, pre-filled; the Add comment icon sits to its right.
    const top = el("div", "crow");
    const nameLabel = el("label", "f", "Audience");
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.value = aud.name;
    nameInput.readOnly = true;
    nameLabel.appendChild(nameInput);
    const addComment = el("button", "ic tool");
    addComment.type = "button";
    addComment.title = "Add comment";
    addComment.setAttribute("aria-label", "Add comment");
    addComment.innerHTML = '<svg aria-hidden="true"><use href="#i-bmadd"/></svg>'; // static markup only
    addComment.disabled = frozen || aud.turns.length > 0;
    addComment.addEventListener("click", () => newTurn(aud));
    top.append(nameLabel, addComment);
    body.appendChild(top);

    aud.turns.forEach((turn, index) => body.appendChild(turnBlock(tab, aud, turn, index, frozen)));
  }

  // One step of the thread: the Comment (or Audience reply) with its generate button, then the generated reply.
  function turnBlock(tab, aud, turn, index, frozen) {
    const wrap = el("div", "turn");

    const row = el("div", "crow");
    const label = el("label", "f", index === 0 ? "Comment" : "Audience reply");
    const input = el("textarea");
    input.rows = 3;
    input.maxLength = 5000;
    input.value = turn.text;
    input.disabled = frozen;
    label.appendChild(input);
    const tools = el("span", "tools-inner");
    row.append(label, tools);
    wrap.appendChild(row);
    // Changing the text brings the Generate reply button back.
    input.addEventListener("input", () => {
      turn.text = input.value;
      $("threadError").hidden = true;
      paintTurnTools(tools, tab, aud, turn, index, frozen);
    });
    paintTurnTools(tools, tab, aud, turn, index, frozen);

    if (turn.reply) {
      const reply = el("div", "crow");
      const field = el("div", "f");
      const head = el("div", "rhead");
      const copy = el("button", "mini copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(turn.reply.text, copy));
      head.append(el("span", "", "Generated reply"), copy);
      const output = el("textarea");
      output.rows = 4;
      output.readOnly = true;
      output.value = turn.reply.text;
      output.setAttribute("aria-label", "Generated reply");
      field.append(head, output);
      reply.appendChild(field);
      if (index === aud.turns.length - 1) {
        const add = el("button", "ic tool");
        add.type = "button";
        add.title = "Add audience reply";
        add.setAttribute("aria-label", "Add audience reply");
        add.innerHTML = '<svg aria-hidden="true"><use href="#i-bmadd"/></svg>'; // static markup only
        add.disabled = frozen;
        add.addEventListener("click", () => newTurn(aud));
        reply.appendChild(add);
      }
      wrap.appendChild(reply);
    }
    return wrap;
  }

  // Beside the field: the red Generate reply button, nothing for an Inactive client, or "Done".
  function paintTurnTools(tools, tab, aud, turn, index, frozen) {
    tools.replaceChildren();
    if (comm.busy === turn.id) {
      tools.appendChild(el("span", "status busy", "Generating…"));
    } else if (turn.reply && turn.reply.sig === turn.text) {
      tools.appendChild(el("span", "status done", "Done"));
    } else if (tab.data.working) {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Generate reply";
      button.setAttribute("aria-label", "Generate reply");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-spark"/></svg>'; // static markup only
      button.disabled = frozen;
      button.addEventListener("click", () => generateReply(tab, aud, turn, index));
      tools.appendChild(button);
    }
  }

  async function generateReply(tab, aud, turn, index) {
    const error = $("threadError");
    const message = turn.text.trim();
    const template = ismco.items.find((item) => item.id === Number($("cp-template").value)) || null;
    const problem = !message ? (index === 0 ? "Write the comment first." : "Write the audience reply first.")
      : !template ? "Choose an ISMCO template first. Add one in ISMCO and set Applies to Community Management & Engagement." : "";
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    comm.busy = turn.id;
    renderThread();

    const sig = turn.text;
    let failure = "";
    try {
      const language = bank.items.find((item) => item.id === Number($("cp-lang").value));
      const note = research.items.find((item) => item.id === Number($("cp-note").value));
      const result = await requestReply({
        client: compClient(tab),
        post: ($("cp-title").selectedOptions[0] || {}).textContent || "",
        caption: $("cp-caption").value.trim(),
        audience: aud.name.trim(),
        thread: aud.turns.slice(0, index).map((step) => ({ audience: step.text, reply: step.reply ? step.reply.text : "" })),
        message,
        format: "plain text",
        language: language ? language.text : "",
        research: note ? { title: note.title, text: note.text } : null,
        template: { title: template.title, intent: template.intent, scope: template.scope, method: template.method, constraints: template.constraints, output: template.output }
      });
      turn.reply = { text: plainText(result.reply), at: result.generated_at, sig };
    } catch (problemFound) {
      failure = problemFound.message;
    }
    comm.busy = null;
    if (comm.viewing === aud) {
      renderThread();
      if (failure) {
        error.textContent = failure;
        error.hidden = false;
      }
    }
  }

  function buildCommunityPane(tab) {
    const name = compClient(tab);
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", name || `#${tab.number}`);
    pane.innerHTML = '<div class="pane-head"><h2 data-title></h2></div><div class="form"><div class="notes-grid" data-items></div></div>'; // static markup only; names are set below as text
    pane.querySelector("[data-title]").textContent = name || `#${tab.number}`;
    const grid = pane.querySelector("[data-items]");
    const items = commOf(tab).items;
    if (!items.length) grid.appendChild(el("p", "empty", "No posts yet. Use the Add post button to add one."));
    else items.forEach((item) => grid.appendChild(postCard(tab, item)));
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderCommunity() {
    const hasTabs = state.tabs.length > 0;
    commBlank.hidden = hasTabs;
    commTabset.hidden = !hasTabs;
    $("addPostButton").disabled = !hasTabs;
    commRail.replaceChildren();
    commHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === comm.activeId) || state.tabs[0];
    comm.activeId = open.id;
    $("addPostButton").disabled = !open.data.working; // an Inactive client cannot get new posts
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      button.title = compClient(tab) ? `#${tab.number} – ${compClient(tab)}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        comm.activeId = tab.id;
        renderCommunity();
      });
      commRail.appendChild(button);
    });
    commHost.appendChild(buildCommunityPane(open));
  }

  $("addPostButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === comm.activeId) || state.tabs[0];
    if (tab) openPostForm(tab, null);
  });
  // Client names, languages, notes and templates change elsewhere, so the subtabs are drawn again
  // whenever the Community Management & Engagement section is opened from the sidebar.
  window.addEventListener("hashchange", () => { if (location.hash === "#community") renderCommunity(); });

  /* ---------- Audience Analysis (Documentation & Workflow Support) ---------- */

  // Base URL of the Cloudflare Worker that asks gemini-3.5-flash-lite to analyze the audience of a post.
  // While it is empty, a sample analysis is shown so the states can be previewed.
  const AA_API = "";
  const aa = { activeId: null, editing: null, draft: null, busy: false, nextId: 1 };
  const aaBlank = $("audienceBlank");
  const aaTabset = $("audienceTabset");
  const aaRail = $("audienceRail");
  const aaHost = $("audiencePane");
  const aaForm = $("aaFormPopup");
  const aaView = $("aaViewPopup");
  const aaError = $("aaError");

  // Each client tab holds its own analyses: { id, postId, postTitle, caption, templateId, analysis: { text, at, sig } | null }
  function aaOf(tab) { return tab.analyses || (tab.analyses = { items: [] }); }
  // Only the posts of the same client, from its tab in Community Management & Engagement.
  const postOf = (tab, id) => commOf(tab).items.find((post) => post.id === id) || null;
  const aaTab = () => (aa.editing ? tabById(aa.editing.tabId) : null);
  const aaValues = () => ({ postId: Number($("aa-post").value) || null, templateId: Number($("aa-template").value) || null });

  // Everything the analysis depends on. If it changes after an analysis, the audience needs analyzing again.
  function aaSig(tab, postId, templateId) {
    const post = tab ? postOf(tab, postId) : null;
    const template = ismco.items.find((item) => item.id === templateId);
    return JSON.stringify({
      post: post ? [post.id, post.title, post.caption, post.audiences.map((aud) => [aud.name, aud.turns.map((turn) => [turn.text, turn.reply ? turn.reply.text : ""])])] : null,
      template: template ? [template.id, template.updated] : null
    });
  }

  // A sample analysis, written the way the real one will look, until the Worker is connected.
  function mockAudienceAnalysis(p) {
    const messages = p.audiences.reduce((sum, aud) => sum + aud.thread.length, 0);
    return [
      `Audience analysis for “${p.post}”${p.client ? ` (${p.client})` : ""}.`,
      "",
      `${p.audiences.length} audience member${p.audiences.length === 1 ? "" : "s"} took part, with ${messages} message${messages === 1 ? "" : "s"} in total.`,
      "",
      "What stands out:",
      "- Most comments ask for practical detail rather than general praise.",
      "- Replies that answered the question directly kept the conversation going.",
      "",
      "Suggested next steps:",
      "- Answer common questions in the caption of the next post.",
      "- Reply within a day to keep the audience engaged.",
      "",
      "Sample analysis for preview only. The real analysis will come from gemini-3.5-flash-lite."
    ].join("\n");
  }

  // The Worker answers { analysis, analyzed_at }.
  async function requestAudienceAnalysis(payload) {
    if (!AA_API) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { analysis: mockAudienceAnalysis(payload), analyzed_at: new Date().toISOString() };
    }
    let response;
    try {
      response = await fetch(`${AA_API.replace(/\/+$/, "")}/api/audience/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  /* Cards work like the Research Notes cards: Copy, View, Edit and Delete. */
  function aaCard(tab, item) {
    const post = postOf(tab, item.postId);
    const title = post ? post.title : item.postTitle;
    const card = el("div", "bm");

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(item.analysis ? item.analysis.text : title, copy));

    const view = iconButton("i-view", "View details");
    view.classList.add("view");
    view.addEventListener("click", () => openAnalysisView(tab, item));

    const body = el("div", "bm-body");
    body.append(el("h3", "", title), el("p", "bm-snippet", item.analysis ? item.analysis.text : "Not analyzed yet."));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.setAttribute("popovertarget", "deleteTabPopup");
    del.addEventListener("click", () => { state.deleting = { kind: "analysis", tabId: tab.id, id: item.id }; });

    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openAnalysisForm(tab, item));
    del.disabled = edit.disabled = !tab.data.working; // an Inactive client cannot change its analyses

    card.append(copy, view, body, del, edit);
    return card;
  }

  function openAnalysisView(tab, item) {
    const post = postOf(tab, item.postId);
    const template = ismco.items.find((entry) => entry.id === item.templateId);
    $("aaViewTitle").textContent = post ? post.title : item.postTitle;
    const body = $("aaViewBody");
    body.replaceChildren();
    [
      ["Caption", post ? post.caption : item.caption],
      ["ISMCO Template", template ? template.title : "None"],
      ["Audience analysis", item.analysis ? item.analysis.text : "Not analyzed yet."]
    ].forEach(([label, text]) => {
      const field = el("div", "vm-field");
      field.append(el("span", "vm-label", label), el("p", "vm-text", text));
      body.appendChild(field);
    });
    aaView.showPopover();
  }

  // The caption follows the selected post.
  function syncAnalysisForm() {
    const tab = aaTab();
    const post = tab ? postOf(tab, aaValues().postId) : null;
    $("aa-caption").value = post ? post.caption : (aa.editing && aa.editing.item ? aa.editing.item.caption : "");
  }

  // Beside the template: the red Analyze the audience button, nothing for an Inactive client, or "Analyzed".
  function paintAnalysisTools() {
    const tab = aaTab();
    if (!tab) return;
    $("aa-text").value = aa.draft ? aa.draft.text : "";
    const tools = $("aa-tools");
    tools.replaceChildren();
    const { postId, templateId } = aaValues();
    $("aa-post").disabled = false; // the Post can only be changed while the audience is not marked "Analyzed"
    if (aa.busy) {
      tools.appendChild(el("span", "status busy", "Analyzing…"));
    } else if (aa.draft && aa.draft.sig === aaSig(tab, postId, templateId)) {
      tools.appendChild(el("span", "status done", "Analyzed"));
      $("aa-post").disabled = true;
    } else if (tab.data.working) {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Analyze the audience";
      button.setAttribute("aria-label", "Analyze the audience");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-spark"/></svg>'; // static markup only
      button.addEventListener("click", analyzeAudience);
      tools.appendChild(button);
    }
  }

  async function analyzeAudience() {
    const tab = aaTab();
    if (!tab) return;
    const error = $("aaWriteErr");
    const { postId, templateId } = aaValues();
    const post = postOf(tab, postId);
    const template = ismco.items.find((item) => item.id === templateId);
    const problem = !post ? "Choose a post first."
      : !template ? "Choose an ISMCO template first. Add one in ISMCO and set Applies to Audience Analysis."
        : !post.audiences.some((aud) => aud.turns.length) ? "This post has no comments yet. Add comments to its audience in Community Management & Engagement first." : "";
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    aa.busy = true;
    paintAnalysisTools();

    const sig = aaSig(tab, postId, templateId);
    let message = "";
    try {
      const result = await requestAudienceAnalysis({
        client: compClient(tab),
        post: post.title,
        caption: post.caption,
        audiences: post.audiences.map((aud) => ({
          name: aud.name.trim(),
          thread: aud.turns.map((turn) => ({ audience: turn.text, reply: turn.reply ? turn.reply.text : "" }))
        })),
        format: "plain text",
        template: { title: template.title, intent: template.intent, scope: template.scope, method: template.method, constraints: template.constraints, output: template.output }
      });
      aa.draft = { text: plainText(result.analysis), at: result.analyzed_at, sig };
    } catch (failure) {
      message = failure.message;
    }
    aa.busy = false;
    paintAnalysisTools();
    if (message) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  // Add and edit use the same popup. The analysis is held in aa.draft and saved with the Save button.
  function openAnalysisForm(tab, item) {
    aa.editing = { tabId: tab.id, item: item || null };
    aa.draft = item && item.analysis ? { ...item.analysis } : null;
    aa.busy = false;
    $("aaFormTitle").textContent = item ? "Edit analysis" : "Add analysis";
    const rows = commOf(tab).items.map((post) => [post.id, post.title]);
    if (item && !postOf(tab, item.postId)) rows.push([item.postId, `${item.postTitle} (post deleted)`]);
    setOptions($("aa-post"), rows, item && item.postId, "No posts for this client yet. Add one in Community Management & Engagement first.", false);
    setOptions($("aa-template"), ismco.items.filter((entry) => entry.applies === "audience").map((entry) => [entry.id, entry.title]), item && item.templateId, "No ISMCO template applies to Audience Analysis yet", false);
    syncAnalysisForm();
    aaError.hidden = true;
    $("aaWriteErr").hidden = true;
    paintAnalysisTools();
    aaForm.showPopover();
    $("aa-post").focus();
  }

  // Changing the Post or the ISMCO Template makes the analysis out of date, so the button comes back.
  $("aa-post").addEventListener("change", () => { syncAnalysisForm(); paintAnalysisTools(); });
  $("aa-template").addEventListener("change", paintAnalysisTools);

  aaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = aaTab();
    if (!tab) return;
    const { postId, templateId } = aaValues();
    if (!postId) {
      aaError.textContent = "Choose a post. Add one for this client in Community Management & Engagement first.";
      aaError.hidden = false;
      return;
    }
    const post = postOf(tab, postId);
    const previous = aa.editing.item || {};
    const values = {
      postId,
      postTitle: post ? post.title : previous.postTitle,
      caption: post ? post.caption : previous.caption,
      templateId,
      analysis: aa.draft
    };
    if (aa.editing.item) Object.assign(aa.editing.item, values);
    else aaOf(tab).items.push({ id: aa.nextId++, ...values });
    aa.editing = null;
    aa.draft = null;
    aaForm.hidePopover();
    renderAnalyses();
  });

  function buildAnalysisPane(tab) {
    const name = compClient(tab);
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", name || `#${tab.number}`);
    pane.innerHTML = '<div class="pane-head"><h2 data-title></h2></div><div class="form"><div class="notes-grid" data-items></div></div>'; // static markup only; names are set below as text
    pane.querySelector("[data-title]").textContent = name || `#${tab.number}`;
    const grid = pane.querySelector("[data-items]");
    const items = aaOf(tab).items;
    if (!items.length) grid.appendChild(el("p", "empty", "No analyses yet. Use the + Add analysis button to add one."));
    else items.forEach((item) => grid.appendChild(aaCard(tab, item)));
    return pane;
  }

  // One subtab for each Consultations tab, in the same order and with the same #numbers.
  function renderAnalyses() {
    const hasTabs = state.tabs.length > 0;
    aaBlank.hidden = hasTabs;
    aaTabset.hidden = !hasTabs;
    $("addAnalysisButton").disabled = !hasTabs;
    aaRail.replaceChildren();
    aaHost.replaceChildren();
    if (!hasTabs) return;

    const open = state.tabs.find((tab) => tab.id === aa.activeId) || state.tabs[0];
    aa.activeId = open.id;
    $("addAnalysisButton").disabled = !open.data.working; // an Inactive client cannot get new analyses
    state.tabs.forEach((tab) => {
      const button = el("button", "vtab", `#${tab.number}`);
      button.type = "button";
      button.title = compClient(tab) ? `#${tab.number} – ${compClient(tab)}` : `#${tab.number}`;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => {
        aa.activeId = tab.id;
        renderAnalyses();
      });
      aaRail.appendChild(button);
    });
    aaHost.appendChild(buildAnalysisPane(open));
  }

  $("addAnalysisButton").addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === aa.activeId) || state.tabs[0];
    if (tab) openAnalysisForm(tab, null);
  });
  // Client names, posts and templates change elsewhere, so the subtabs are drawn again
  // whenever this tab is opened, or the Documentation & Workflow Support section is opened from the sidebar.
  $("documentation-tab-audience").addEventListener("change", renderAnalyses);
  window.addEventListener("hashchange", () => { if (location.hash === "#documentation") renderAnalyses(); });

  /* ---------- Events (Documentation & Workflow Support) ---------- */

  // Base URL of the Cloudflare Worker. It gives the server date (GET /api/events/now) and saves each recording
  // in the D1 database (POST /api/events/record). While it is empty, this device's clock stands in for the preview.
  const EVENTS_API = "";
  const events = { now: null, records: [], last: new Map(), busy: false, error: "" };
  const eventsGrid = $("eventsGrid");

  async function serverCall(path, options) {
    if (!EVENTS_API) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const now = new Date().toISOString();
      return path === "/api/events/now" ? { now } : { recorded_at: now };
    }
    let response;
    try {
      response = await fetch(`${EVENTS_API.replace(/\/+$/, "")}${path}`, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json" }, cache: "no-store", credentials: "omit" });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  // "9:31 pm"
  function clock(date) {
    const hour = date.getUTCHours();
    return `${hour % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}`;
  }
  // "9:31 pm UTC (5:31 am UTC+8)": the UTC+8 time is worked out from the recorded UTC time.
  const timesOf = (iso) => `${clock(new Date(iso))} UTC (${clock(new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000))} UTC+8)`;
  const dateOf = (iso) => { const d = new Date(iso); return `${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const monthOf = (iso) => { const d = new Date(iso); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const monthName = (key) => `${MONTHS[key % 12]} ${Math.floor(key / 12)}`;

  // What the user has put into the six tabs, as text they wrote or chose (and the audience analysis they saved).
  // Each record may carry: say(verb) = the sentence to record, group = merged into one sentence, noDelete = never reported as deleted.
  function activitySnapshot() {
    const snap = new Map();
    const put = (key, area, client, noun, label, sig, extra) => snap.set(key, { area, client, noun, label: snip(String(label || "").trim() || "Untitled", 40), sig: JSON.stringify(sig), ...extra });
    const list = (label, items) => (items && items.length ? `${label}: ${items.join(", ")}.` : "");
    const words = (...parts) => parts.filter(Boolean).join(" ");
    kw.items.forEach((e) => put(`kw:${e.id}`, "Keyword Research", entryClient(e), "keywords", e.primary, [e.clientId, e.primary, e.synonyms, e.longtail, e.questions], {
      say: () => words("Doing keyword research.", `Primary keyword: ${e.primary}.`, list("Synonyms", e.synonyms), list("Long-tail keywords", e.longtail), list("Questions", e.questions))
    }));
    research.items.forEach((n) => put(`rn:${n.id}`, "Research Notes", null, "note", n.title, [n.title, n.text], { group: "research", full: n.title.trim() || "Untitled" }));
    state.tabs.forEach((tab) => {
      const client = clientLabel(tab);
      tab.comp.competitors.forEach((c, i) => put(`co:${tab.id}:${c.id}`, "Competition Analysis", client, "competitor", c.name.trim() || `Competitor #${i + 1}`, [c.name], { group: "comp", part: "competitor", full: c.name.trim() || `Competitor #${i + 1}` }));
      tab.comp.notes.forEach((n) => put(`cn:${tab.id}:${n.id}`, "Competition Analysis", client, "note", n.title, [n.title, n.text, n.competitorId], { group: "comp", part: "note", full: n.title.trim() || "Untitled", owner: compOwnerName(tab, n) }));
      commOf(tab).items.forEach((p) => {
        put(`po:${tab.id}:${p.id}`, "Community Management & Engagement", client, "post", p.title, [p.title, p.caption, p.langId, p.noteId, p.templateId, p.audiences.map((a) => a.name)]);
        // Each comment or audience reply in the audience threads is recorded once.
        p.audiences.forEach((a, index) => a.turns.forEach((t) => {
          const text = t.text.trim();
          if (!text) return;
          put(`th:${tab.id}:${p.id}:${a.id}:${t.id}`, "Community Management & Engagement", client, "comment", text, [text], {
            noDelete: true,
            say: () => `The audience ${a.name.trim() || `Audience #${index + 1}`} engaged with the post ${p.title} with the comment: ${text}${/[.!?]$/.test(text) ? "" : "."}`
          });
        }));
      });
      contOf(tab).items.forEach((i) => {
        const part = itemParts(i);
        put(`ct:${tab.id}:${i.id}`, "Content", client, "content", i.title, [i.title, i.kind, i.kwId, i.langId, i.noteId, i.templateId], {
          say: (verb) => words(`${verb} “${i.title}” (${i.kind}) in Content.`, part.keyword ? `Primary keyword: ${part.keyword.primary}.` : "", part.keyword ? list("Synonyms", part.keyword.synonyms) : "", part.keyword ? list("Long-tail keywords", part.keyword.longtail) : "", part.keyword ? list("Questions", part.keyword.questions) : "", part.note ? `Research notes: ${part.note.title}.` : "")
        });
      });
      aaOf(tab).items.forEach((i) => {
        const post = postOf(tab, i.postId);
        const title = post ? post.title : i.postTitle;
        put(`au:${tab.id}:${i.id}`, "Audience Analysis", client, "audience analysis", title, [i.postId, i.templateId, i.analysis ? i.analysis.text : ""], i.analysis ? {
          say: () => `Analyzed the audience for the post “${title}” with the following result: ${i.analysis.text}`
        } : undefined);
      });
    });
    return snap;
  }

  // The difference from the last recording: one entry for each client, listing what was added, edited or deleted.
  function activityEntries(last, cur) {
    const byClient = new Map();
    const add = (client, text) => {
      const key = client || "";
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(text);
    };
    const phrase = (verb, rec) => `${verb} ${rec.noun} “${rec.label}” in ${rec.area}`;
    const compBuckets = new Map(); // client -> { names, notes }
    const researchBuckets = { Added: [], Edited: [] };
    cur.forEach((rec, key) => {
      const old = last.get(key);
      const verb = !old ? "Added" : old.sig !== rec.sig ? "Edited" : "";
      if (!verb) return;
      if (rec.group === "comp") {
        if (!compBuckets.has(rec.client)) compBuckets.set(rec.client, { names: [], notes: [] });
        const bucket = compBuckets.get(rec.client);
        const name = rec.part === "competitor" ? rec.full : rec.owner;
        if (name && !bucket.names.includes(name)) bucket.names.push(name);
        if (rec.part === "note") bucket.notes.push(rec.full);
      } else if (rec.group === "research") {
        researchBuckets[verb].push(rec.full);
      } else if (rec.say) {
        add(rec.client, rec.say(verb));
      } else {
        add(rec.client, phrase(verb, rec));
      }
    });
    compBuckets.forEach((bucket, client) => {
      const head = bucket.names.length ? `Analyzed competitor/s: ${bucket.names.join(", ")}` : "Analyzed competitors";
      add(client, `${head}${bucket.notes.length ? `, with the following notes: ${bucket.notes.join(", ")}` : ""}.`);
    });
    ["Added", "Edited"].forEach((verb) => {
      if (researchBuckets[verb].length) add(null, `${verb} ${researchBuckets[verb].join(", ")} in Research Notes`);
    });
    last.forEach((rec, key) => { if (!cur.has(key) && !rec.noDelete) add(rec.client, phrase("Deleted", rec)); });
    // Sentences that already end with a period are joined with a space; the others with a semicolon.
    return [...byClient].map(([client, texts]) => ({ client: client || null, text: texts.reduce((all, text) => `${all}${/[.!?]$/.test(all) ? " " : "; "}${text}`) }));
  }

  // Beside the month: the red Record activity button, or "Recorded" once nothing has changed since.
  function paintEventTools(tools) {
    tools.replaceChildren();
    if (events.busy) {
      tools.appendChild(el("span", "status busy", "Recording…"));
    } else if (!activityEntries(events.last, activitySnapshot()).length) {
      tools.appendChild(el("span", "status done", "Recorded"));
    } else {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Record activity";
      button.setAttribute("aria-label", "Record activity");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-clock"/></svg>'; // static markup only
      button.addEventListener("click", recordActivity);
      tools.appendChild(button);
    }
  }

  // The date and time of every recording come from the Cloudflare server, which also saves them in D1.
  async function recordActivity() {
    const cur = activitySnapshot();
    const entries = activityEntries(events.last, cur);
    if (!entries.length) return;
    events.busy = true;
    events.error = "";
    renderEvents();
    try {
      const result = await serverCall("/api/events/record", { method: "POST", body: JSON.stringify({ entries }) });
      entries.forEach((entry) => events.records.push({ at: result.recorded_at, client: entry.client, text: entry.text }));
      events.last = cur;
      events.now = result.recorded_at;
    } catch (failure) {
      events.error = failure.message;
    }
    events.busy = false;
    renderEvents();
  }

  // One section for each month (newest first); inside, one block for each date with a line for each recording.
  function renderEvents() {
    eventsGrid.replaceChildren();
    if (!events.now) {
      eventsGrid.appendChild(el("p", events.error ? "form-error" : "sub", events.error || "Loading the server date…"));
      return;
    }
    if (events.error) eventsGrid.appendChild(el("p", "form-error", events.error));
    const current = monthOf(events.now);
    const months = new Map([[current, []]]);
    events.records.forEach((record) => {
      const key = monthOf(record.at);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(record);
    });
    [...months.keys()].sort((a, b) => b - a).forEach((key) => {
      const section = el("section", "events-section");
      const head = el("div", "events-head");
      head.appendChild(el("h2", "", monthName(key)));
      if (key === current) {
        const tools = el("span", "tools-inner");
        head.appendChild(tools);
        paintEventTools(tools);
      }
      section.appendChild(head);

      const days = new Map();
      months.get(key).forEach((record) => {
        const day = new Date(record.at).toISOString().slice(0, 10);
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(record);
      });
      const text = [...days.keys()].sort().reverse().map((day) => {
        const rows = days.get(day);
        return [dateOf(rows[0].at), ...rows.map((record) => `${timesOf(record.at)} - ${record.client ? `for ${record.client} - ` : ""}${record.text}`)].join("\n");
      }).join("\n\n");
      section.appendChild(el("p", "vm-text events-text", text || "No activity recorded yet."));
      eventsGrid.appendChild(section);
    });
  }

  async function refreshEvents() {
    try {
      events.now = (await serverCall("/api/events/now", { method: "GET" })).now;
      events.error = "";
    } catch (failure) {
      events.error = failure.message;
    }
    renderEvents();
  }
  // Activity in the other tabs changes the button, so the Events tab is drawn again whenever it is opened.
  $("documentation-tab-events").addEventListener("change", refreshEvents);
  window.addEventListener("hashchange", () => { if (location.hash === "#documentation") refreshEvents(); });

  /* ---------- Workflow Analysis (Documentation & Workflow Support) ---------- */

  // Base URL of the Cloudflare Worker that asks gemini-3.5-flash-lite to analyze the workflow recorded in Events.
  // While it is empty, a sample analysis is shown so the states can be previewed.
  const WF_API = "";
  const wf = { items: [], editing: null, draft: null, busy: false, nextId: 1 };
  const wfGrid = $("workflowGrid");
  const wfForm = $("wfFormPopup");
  const wfView = $("wfViewPopup");
  const wfError = $("wfError");

  // The recorded dates of the Events tab, oldest first (as yyyy-mm-dd, the same day split the Events tab uses).
  const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);
  const wfDates = () => [...new Set(events.records.map((record) => dayOf(record.at)))].sort();
  const wfValues = () => ({ startKey: $("wf-start").value, endKey: $("wf-end").value, templateId: Number($("wf-template").value) || null });
  const wfTitle = (item) => `${dateOf(item.startKey)} to ${dateOf(item.endKey)}`;

  // The recorded activities from the start date to the end date, written the way the Events tab shows them.
  function wfEventsText(startKey, endKey) {
    const days = new Map();
    events.records.forEach((record) => {
      const day = dayOf(record.at);
      if (day < startKey || day > endKey) return;
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(record);
    });
    return [...days.keys()].sort().map((day) => {
      const rows = days.get(day);
      return [dateOf(rows[0].at), ...rows.map((record) => `${timesOf(record.at)} - ${record.client ? `for ${record.client} - ` : ""}${record.text}`)].join("\n");
    }).join("\n\n");
  }

  // Everything the analysis depends on. If it changes after an analysis, the workflow needs analyzing again.
  function wfSig(values) {
    const template = ismco.items.find((item) => item.id === values.templateId);
    return JSON.stringify({
      from: values.startKey,
      to: values.endKey,
      events: values.startKey && values.endKey ? wfEventsText(values.startKey, values.endKey) : "",
      template: template ? [template.id, template.updated] : null
    });
  }

  // A sample analysis, written the way the real one will look, until the Worker is connected.
  function mockWorkflowAnalysis(p) {
    const lines = p.events.split("\n").filter((line) => line.includes(" - ")).length;
    return [
      `Workflow analysis for ${p.start} to ${p.end}.`,
      "",
      `${lines} recorded activit${lines === 1 ? "y" : "ies"} in this period.`,
      "",
      "What stands out:",
      "- Work was spread across several areas rather than one at a time.",
      "- Research came before content, which kept the writing focused.",
      "",
      "Suggested next steps:",
      "- Record activity at the end of each work session.",
      "- Batch similar tasks together to reduce switching.",
      "",
      "Sample analysis for preview only. The real analysis will come from gemini-3.5-flash-lite."
    ].join("\n");
  }

  // The Worker answers { analysis, analyzed_at }.
  async function requestWorkflowAnalysis(payload) {
    if (!WF_API) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { analysis: mockWorkflowAnalysis(payload), analyzed_at: new Date().toISOString() };
    }
    let response;
    try {
      response = await fetch(`${WF_API.replace(/\/+$/, "")}/api/workflow/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  /* Cards work like the Research Notes cards: Copy, View, Edit and Delete. */
  function renderWorkflows() {
    wfGrid.replaceChildren();
    if (!wf.items.length) {
      wfGrid.appendChild(el("p", "empty", "No analyses yet. Use the + Add analysis button to save your first one."));
      return;
    }
    wf.items.forEach((item) => {
      const card = el("div", "bm");

      const copy = el("button", "mini copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(item.analysis ? item.analysis.text : wfTitle(item), copy));

      const view = iconButton("i-view", "View details");
      view.classList.add("view");
      view.addEventListener("click", () => openWorkflowView(item));

      const body = el("div", "bm-body");
      body.append(el("h3", "", wfTitle(item)), el("p", "bm-snippet", item.analysis ? item.analysis.text : "Not analyzed yet."));

      const del = el("button", "mini del", "Delete");
      del.type = "button";
      del.setAttribute("popovertarget", "deleteTabPopup");
      del.addEventListener("click", () => { state.deleting = { kind: "workflow", id: item.id }; });

      const edit = el("button", "mini edit", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openWorkflowForm(item));

      card.append(copy, view, body, del, edit);
      wfGrid.appendChild(card);
    });
  }

  function openWorkflowView(item) {
    const template = ismco.items.find((entry) => entry.id === item.templateId);
    $("wfViewTitle").textContent = wfTitle(item);
    const body = $("wfViewBody");
    body.replaceChildren();
    [
      ["Events analyzed", wfTitle(item)],
      ["ISMCO Template", template ? template.title : "None"],
      ["Workflow analysis", item.analysis ? item.analysis.text : "Not analyzed yet."]
    ].forEach(([label, text]) => {
      const field = el("div", "vm-field");
      field.append(el("span", "vm-label", label), el("p", "vm-text", text));
      body.appendChild(field);
    });
    wfView.showPopover();
  }

  // The end date lists only the recorded dates later than the start date.
  function fillWorkflowEnd(endKey) {
    const start = $("wf-start").value;
    const later = wfDates().filter((key) => start && key > start);
    setOptions($("wf-end"), later.map((key) => [key, dateOf(key)]), endKey, "No later date recorded", false);
  }

  // Beside the template: the red Analyze the workflow button, nothing when there is nothing to analyze, or "Analyzed".
  function paintWorkflowTools() {
    $("wf-text").value = wf.draft ? wf.draft.text : "";
    const tools = $("wf-tools");
    tools.replaceChildren();
    const values = wfValues();
    if (wf.busy) {
      tools.appendChild(el("span", "status busy", "Analyzing…"));
    } else if (wf.draft && wf.draft.sig === wfSig(values)) {
      tools.appendChild(el("span", "status done", "Analyzed"));
    } else if (values.startKey && values.endKey) {
      const button = el("button", "ic tool analyze");
      button.type = "button";
      button.title = "Analyze the workflow";
      button.setAttribute("aria-label", "Analyze the workflow");
      button.innerHTML = '<svg aria-hidden="true"><use href="#i-spark"/></svg>'; // static markup only
      button.addEventListener("click", analyzeWorkflow);
      tools.appendChild(button);
    }
  }

  async function analyzeWorkflow() {
    const error = $("wfWriteErr");
    const values = wfValues();
    const template = ismco.items.find((item) => item.id === values.templateId);
    const problem = !values.startKey || !values.endKey ? "Choose a start date and a later end date. Record activity in Events first."
      : !template ? "Choose an ISMCO template first. Add one in ISMCO and set Applies to Workflow Analysis." : "";
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    wf.busy = true;
    paintWorkflowTools();

    const sig = wfSig(values);
    let message = "";
    try {
      const result = await requestWorkflowAnalysis({
        start: dateOf(values.startKey),
        end: dateOf(values.endKey),
        events: wfEventsText(values.startKey, values.endKey),
        format: "plain text",
        template: { title: template.title, intent: template.intent, scope: template.scope, method: template.method, constraints: template.constraints, output: template.output }
      });
      wf.draft = { text: plainText(result.analysis), at: result.analyzed_at, sig };
    } catch (failure) {
      message = failure.message;
    }
    wf.busy = false;
    paintWorkflowTools();
    if (message) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  // Add and edit use the same popup. The analysis is held in wf.draft and saved with the Save button.
  function openWorkflowForm(item) {
    wf.editing = item || null;
    wf.draft = item && item.analysis ? { ...item.analysis } : null;
    wf.busy = false;
    $("wfFormTitle").textContent = item ? "Edit analysis" : "Add analysis";
    setOptions($("wf-start"), wfDates().map((key) => [key, dateOf(key)]), item && item.startKey, "No recorded dates yet", false);
    fillWorkflowEnd(item && item.endKey);
    setOptions($("wf-template"), ismco.items.filter((entry) => entry.applies === "workflow").map((entry) => [entry.id, entry.title]), item && item.templateId, "No ISMCO template applies to Workflow Analysis yet", false);
    wfError.hidden = true;
    $("wfWriteErr").hidden = true;
    paintWorkflowTools();
    wfForm.showPopover();
    $("wf-start").focus();
  }

  // Changing the dates or the ISMCO Template makes the analysis out of date, so the button comes back.
  $("wf-start").addEventListener("change", () => { fillWorkflowEnd($("wf-end").value); paintWorkflowTools(); });
  $("wf-end").addEventListener("change", paintWorkflowTools);
  $("wf-template").addEventListener("change", paintWorkflowTools);

  wfForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = wfValues();
    if (!values.startKey || !values.endKey) {
      wfError.textContent = "Choose a start date and a later end date. Record activity in Events first.";
      wfError.hidden = false;
      return;
    }
    const saved = { startKey: values.startKey, endKey: values.endKey, templateId: values.templateId, analysis: wf.draft };
    if (wf.editing) Object.assign(wf.editing, saved);
    else wf.items.push({ id: wf.nextId++, ...saved });
    wf.editing = null;
    wf.draft = null;
    wfForm.hidePopover();
    renderWorkflows();
  });

  $("addWorkflowButton").addEventListener("click", () => openWorkflowForm(null));
  // New recordings and templates appear elsewhere, so the cards are drawn again whenever this tab is opened.
  $("documentation-tab-workflow").addEventListener("change", renderWorkflows);
  window.addEventListener("hashchange", () => { if (location.hash === "#documentation") renderWorkflows(); });

  /* ---------- Client Reports (Consulting & Client Reporting) ---------- */

  // Cards work like the Research Notes cards: Copy, View, Edit and Delete.
  // Each report: { id, title, goal, comp, research, community, audience }; a part is null when its checkbox is unchecked.
  const REPORT_PARTS = [["goal", "Goal"], ["comp", "Competition Analysis"], ["research", "Research Notes"], ["community", "Community Management & Engagement"], ["audience", "Audience Analysis"]];
  const reports = { items: [], nextId: 1, editing: null };
  const reportsGrid = $("reportsGrid");
  const reportForm = $("reportFormPopup");
  const reportView = $("reportViewPopup");
  const reportError = $("reportError");
  const repName = $("rep-name");
  const repGoal = $("rep-goal");

  GOALS.forEach(([, label]) => {
    const option = el("option", "", label);
    option.value = label;
    repGoal.appendChild(option);
  });

  // Each checkbox shows or hides its own field.
  function syncReportFields() {
    REPORT_PARTS.forEach(([key]) => { $(`rep-${key}-field`).hidden = !$(`rep-${key}-on`).checked; });
  }
  REPORT_PARTS.forEach(([key]) => $(`rep-${key}-on`).addEventListener("change", syncReportFields));

  // What Copy puts on the clipboard and what a card shows: only the parts that are checked.
  function reportText(item) {
    const lines = [];
    REPORT_PARTS.forEach(([key, label]) => {
      if (item[key] === null || item[key] === undefined) return;
      lines.push(key === "goal" ? `${label}: ${item[key]}` : `${label}:\n${item[key]}`);
    });
    return lines.join("\n\n");
  }

  function openReportView(item) {
    $("reportViewTitle").textContent = item.title;
    const body = $("reportViewBody");
    body.replaceChildren();
    REPORT_PARTS.forEach(([key, label]) => {
      if (item[key] === null || item[key] === undefined) return;
      const field = el("div", "vm-field");
      field.append(el("span", "vm-label", label), el("p", "vm-text", item[key]));
      body.appendChild(field);
    });
    if (!body.children.length) body.appendChild(el("p", "vm-text", "No details yet."));
    reportView.showPopover();
  }

  function renderReports() {
    reportsGrid.replaceChildren();
    if (!reports.items.length) {
      reportsGrid.appendChild(el("p", "empty", "No reports yet. Choose + Add report to save your first one."));
      return;
    }
    reports.items.forEach((item) => {
      const card = el("div", "bm");

      const copy = el("button", "mini copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(reportText(item) || item.title, copy));

      const view = iconButton("i-view", "View details");
      view.classList.add("view");
      view.addEventListener("click", () => openReportView(item));

      const body = el("div", "bm-body");
      body.append(el("h3", "", item.title), el("p", "bm-snippet", reportText(item) || "No details yet."));

      const del = el("button", "mini del", "Delete");
      del.type = "button";
      del.setAttribute("popovertarget", "deleteTabPopup");
      del.addEventListener("click", () => { state.deleting = { kind: "report", id: item.id }; });

      const edit = el("button", "mini edit", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openReportForm(item));

      card.append(copy, view, body, del, edit);
      reportsGrid.appendChild(card);
    });
  }

  // Add and edit use the same popup.
  function openReportForm(item) {
    reports.editing = item || null;
    $("reportFormTitle").textContent = item ? "Edit report" : "Add a report";
    repName.value = item ? item.title : "";
    REPORT_PARTS.forEach(([key]) => {
      const value = item ? item[key] : null;
      const on = value !== null && value !== undefined;
      $(`rep-${key}-on`).checked = on;
      $(`rep-${key}`).value = on ? value : "";
    });
    if (!repGoal.value) repGoal.selectedIndex = 0;
    syncReportFields();
    reportError.hidden = true;
    reportForm.showPopover();
    repName.focus();
  }

  reportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = repName.value.trim();
    if (!title) {
      reportError.textContent = "Enter what this report is for.";
      reportError.hidden = false;
      return;
    }
    const values = { title };
    for (const [key, label] of REPORT_PARTS) {
      if (!$(`rep-${key}-on`).checked) {
        values[key] = null;
        continue;
      }
      const value = $(`rep-${key}`).value.trim();
      if (!value) {
        reportError.textContent = `Write the text for ${label}, or uncheck it.`;
        reportError.hidden = false;
        return;
      }
      values[key] = value;
    }
    if (reports.editing) Object.assign(reports.editing, values);
    else reports.items.push({ id: reports.nextId++, ...values });
    reports.editing = null;
    reportForm.hidePopover();
    renderReports();
  });

  $("addReportButton").addEventListener("click", () => openReportForm(null));

  /* ---------- Unlock popup (Inactive tabs only) ---------- */

  unlockPhrase.addEventListener("input", () => {
    unlockConfirm.disabled = unlockPhrase.value !== UNLOCK_PHRASE;
  });

  unlockPopup.addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    unlockPhrase.value = "";
    unlockConfirm.disabled = true;
    unlockPhrase.focus();
  });

  unlockConfirm.addEventListener("click", () => {
    const tab = state.tabs.find((item) => item.id === state.unlocking);
    if (unlockPhrase.value !== UNLOCK_PHRASE || !tab) return;
    tab.locked = false;
    moveAfterLock(tab);
    state.unlocking = null;
    render();
  });

  render();
  renderTemplates();
  renderLanguages();
  renderKeywords();
  renderResearchNotes();
  renderReports();
  renderAvoid();
  renderAnalyses();
  renderWorkflows();
  refreshEvents();
})();
