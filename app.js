// Monday.com Subitem Form — application logic.

(function () {
  "use strict";

  const API_URL = "https://api.monday.com/v2";
  const API_VERSION = "2024-10";
  const NOTES_MAX = 2000;

  const statusEl = document.getElementById("status");
  const titleEl = document.getElementById("form-title");
  const subtitleEl = document.getElementById("form-subtitle");
  const formEl = document.getElementById("subitem-form");

  if (typeof MONDAY_CONFIG === "undefined") {
    setStatus(
      "Configuration missing. Copy config.example.js to config.js and fill in values.",
      "error"
    );
    return;
  }

  titleEl.textContent = MONDAY_CONFIG.formTitle || "Create a Task";
  subtitleEl.textContent = MONDAY_CONFIG.formSubtitle || "";
  document.title = MONDAY_CONFIG.formTitle || "Create a Task";

  let items = [];
  let subscribers = [];

  init();

  async function init() {
    setStatus("Loading…", "loading");
    try {
      const [itemsRes, subsRes] = await Promise.all([
        mondayQuery(
          `query ($boardId: ID!, $groupId: String!) {
             boards(ids: [$boardId]) {
               groups(ids: [$groupId]) {
                 items_page(limit: 500) { items { id name } }
               }
             }
           }`,
          { boardId: String(MONDAY_CONFIG.boardId), groupId: String(MONDAY_CONFIG.groupId) }
        ),
        mondayQuery(
          `query ($boardId: ID!) {
             boards(ids: [$boardId]) {
               subscribers { id name }
             }
           }`,
          { boardId: String(MONDAY_CONFIG.boardId) }
        ),
      ]);

      const board = itemsRes?.boards?.[0];
      const group = board?.groups?.[0];
      items = group?.items_page?.items || [];
      subscribers = subsRes?.boards?.[0]?.subscribers || [];

      if (!items.length) {
        setStatus(
          "No parent items found in the configured group. Check boardId and groupId in config.js.",
          "error"
        );
        return;
      }
      if (!subscribers.length) {
        setStatus(
          "No board subscribers found. Add subscribers to the board so they can be selected as assignees.",
          "error"
        );
        return;
      }

      renderForm();
      clearStatus();
    } catch (err) {
      setStatus("Failed to load form data: " + err.message, "error");
    }
  }

  async function mondayQuery(query, variables) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MONDAY_CONFIG.apiToken,
        "API-Version": API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    if (json.error_message) throw new Error(json.error_message);
    return json.data;
  }

  function renderForm() {
    formEl.innerHTML = `
      <div class="field">
        <label class="field__label" for="parent">Please Select the Meeting to Rate <span class="req">*</span></label>
        <select id="parent" class="select" required>
          <option value="">Select a task…</option>
          ${items.map((i) => `<option value="${escapeAttr(i.id)}">${escapeHtml(i.name)}</option>`).join("")}
        </select>
        <div class="field__error" data-error-for="parent"></div>
      </div>

      <div class="field">
        <label class="field__label" for="assignee">Who is Submitting <span class="req">*</span></label>
        <select id="assignee" class="select" required>
          <option value="">Select a person…</option>
          ${subscribers.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
        <div class="field__error" data-error-for="assignee"></div>
      </div>

      <fieldset class="field field--rating">
        <legend class="field__label">Rate the Meeting (10 is best) <span class="req">*</span></legend>
        <div class="rating" role="radiogroup" aria-label="Priority rating 1 to 10">
          ${Array.from({ length: 10 }, (_, n) => {
            const v = n + 1;
            return `<label class="rating__tile">
              <input type="radio" name="rating" value="${v}" />
              <span>${v}</span>
            </label>`;
          }).join("")}
        </div>
        <div class="field__error" data-error-for="rating"></div>
      </fieldset>

      <div class="field">
        <label class="field__label" for="notes">Notes</label>
        <textarea id="notes" class="textarea" rows="4" placeholder="Add any relevant notes…" maxlength="${NOTES_MAX}"></textarea>
      </div>

      <div class="form__actions">
        <button type="submit" class="btn" id="submit-btn">Submit</button>
      </div>

      <div id="form-message" class="form__message" role="status" aria-live="polite"></div>
    `;
    formEl.hidden = false;
    formEl.addEventListener("submit", onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearFieldErrors();
    const msgEl = document.getElementById("form-message");
    msgEl.textContent = "";
    msgEl.className = "form__message";

    const parentId = formEl.parent.value;
    const assigneeId = formEl.assignee.value;
    const ratingInput = formEl.querySelector('input[name="rating"]:checked');
    const rating = ratingInput ? parseInt(ratingInput.value, 10) : null;
    const notes = formEl.notes.value.trim().slice(0, NOTES_MAX);

    let hasError = false;
    if (!parentId) { showFieldError("parent", "Please select a parent task."); hasError = true; }
    if (!assigneeId) { showFieldError("assignee", "Please select a person."); hasError = true; }
    if (!rating) { showFieldError("rating", "Please choose a rating from 1 to 10."); hasError = true; }
    if (hasError) return;

    const person = subscribers.find((s) => String(s.id) === String(assigneeId));
    const personName = person ? person.name : "Unknown";
    const itemName = `Meeting Rating - ${personName}`;

    const cols = MONDAY_CONFIG.subitemColumns;
    const columnValues = {
      [cols.assignee]: { personsAndTeams: [{ id: Number(assigneeId), kind: "person" }] },
      [cols.rating]: String(rating),
    };
    if (notes) columnValues[cols.notes] = notes;

    const submitBtn = document.getElementById("submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      const data = await mondayQuery(
        `mutation ($parentId: ID!, $name: String!, $cols: JSON!) {
           create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cols) {
             id name
           }
         }`,
        {
          parentId: String(parentId),
          name: itemName,
          cols: JSON.stringify(columnValues),
        }
      );
      const created = data?.create_subitem;
      msgEl.className = "form__message form__message--success";
      msgEl.textContent = `Created: ${created?.name || itemName}`;

      // Reset assignee, rating, notes; keep parent selected.
      formEl.assignee.value = "";
      if (ratingInput) ratingInput.checked = false;
      formEl.notes.value = "";
    } catch (err) {
      msgEl.className = "form__message form__message--error";
      msgEl.textContent = "Submission failed: " + err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }

  function showFieldError(name, text) {
    const el = formEl.querySelector(`[data-error-for="${name}"]`);
    if (el) el.textContent = text;
  }

  function clearFieldErrors() {
    formEl.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " status--" + kind : "");
  }

  function clearStatus() {
    statusEl.textContent = "";
    statusEl.className = "status";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function escapeAttr(s) { return escapeHtml(s); }
})();
