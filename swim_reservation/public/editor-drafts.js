// Per-browser-tab drafts, not HA configuration. Never send draft contents to logs.
const draftKey = 'swim-editor-drafts-v1';
const bookingTabs = ['priority', 'multiple', 'profiles-parallel', 'watch'];
let editorDrafts = {}, draftsReady = false, restoringDraft = false;

function editorSnapshot() {
  return { config: structuredClone(readConfig()), planName: document.getElementById('planName').value,
    watchInterval: document.getElementById('watchInterval').value, watchEndsAt: document.getElementById('watchEndsAt').value,
    editingPlan: editingPlan ? { ...editingPlan } : null };
}
function draftSignature(snapshot) { return JSON.stringify([snapshot.config, snapshot.planName, snapshot.watchInterval, snapshot.watchEndsAt, snapshot.editingPlan]); }
function persistDrafts() {
  if (!draftsReady || restoringDraft) return;
  try { sessionStorage.setItem(draftKey, JSON.stringify({ drafts: editorDrafts, tab: workspaceTab })); }
  catch { /* Storage-disabled WebViews still retain in-memory drafts. */ }
}
function captureEditorDraft() {
  if (!draftsReady || restoringDraft) return;
  if (bookingTabs.includes(workspaceTab)) {
    const previous = editorDrafts[workspaceTab];
    editorDrafts[workspaceTab] = { ...editorSnapshot(), completion: previous?.completion || null };
  }
  persistDrafts();
}
function restoreEditorDraft(tab) {
  restoringDraft = true;
  try {
    const draft = editorDrafts[tab];
    if (!draft) { resetPlanEditor(tab); return; }
    loadConfig(draft.config);
    document.getElementById('planName').value = draft.planName || '';
    document.getElementById('watchInterval').value = draft.watchInterval || '60';
    document.getElementById('watchEndsAt').value = draft.watchEndsAt || '';
    editingPlan = draft.editingPlan || null;
    renderPlanEditMode(); updateWatchDeadlineHint();
    if (typeof renderBookingProfileSelectors === 'function') renderBookingProfileSelectors();
  } catch {
    delete editorDrafts[tab];
    resetPlanEditor(tab);
  } finally { restoringDraft = false; }
}
function initializeEditorDrafts() {
  let tab = workspaceTab;
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (saved?.drafts && typeof saved.drafts === 'object') {
      editorDrafts = Object.fromEntries(bookingTabs.filter(key => saved.drafts[key]?.config).map(key => [key, saved.drafts[key]]));
      if ([...bookingTabs, 'book', 'people', 'monthly', 'logs', 'settings'].includes(saved.tab)) tab = saved.tab;
    }
  } catch { /* Corrupt/disabled storage must not block the UI. */ }
  draftsReady = true;
  const editorTab = bookingTabs.includes(tab) ? tab : Object.keys(editorDrafts)[0];
  if (editorTab && editorDrafts[editorTab]) restoreEditorDraft(editorTab);
  switchWorkspaceTab(tab, { keepEditor: true });
  const capture = event => {
    if (event.target.closest('#settingsCard,#bookingBookCard,#lookupCard')) return;
    captureEditorDraft();
  };
  document.addEventListener('input', capture);
  document.addEventListener('change', capture);
  window.addEventListener('pagehide', captureEditorDraft);
  document.addEventListener('visibilitychange', () => { if (document.hidden) captureEditorDraft(); });
  const dialog = document.getElementById('editorResetDialog');
  document.getElementById('editorResetButton').addEventListener('click', () => dialog.showModal());
  document.getElementById('editorResetCancel').addEventListener('click', () => dialog.close());
  document.getElementById('editorResetConfirm').addEventListener('click', () => {
    editorDrafts = {};
    resetPlanEditor();
    persistDrafts();
    dialog.close();
    planMessage('입력 중인 모든 예약 초안을 초기화했습니다. 저장된 예약자·등록 일정·실제 예약은 변경하지 않았습니다.');
  });
}
function linkDraftToPlan(tab, id, snapshot) {
  if (!draftsReady) return;
  captureEditorDraft();
  const draft = editorDrafts[tab];
  if (draft && draftSignature(draft) === draftSignature(snapshot)) {
    draft.completion = { id, signature: draftSignature(draft) };
    persistDrafts();
  }
}
function clearCompletedDrafts(entries) {
  if (!draftsReady) return;
  captureEditorDraft();
  if (roomDrag) return;
  for (const tab of bookingTabs) {
    const draft = editorDrafts[tab];
    if (!draft?.completion || !entries.some(entry => entry.id === draft.completion.id && entry.status?.state === 'success')) continue;
    if (draftSignature(draft) === draft.completion.signature) {
      delete editorDrafts[tab];
      if (workspaceTab === tab) resetPlanEditor(tab);
    } else draft.completion = null; // Never erase newer input when an older booking completes.
    persistDrafts();
  }
}
