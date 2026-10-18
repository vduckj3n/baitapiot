let debounceTimer;
const TAB_IDS = ['dashboard', 'data-sensor', 'action-history', 'profile'];

function selectTab(tabId) {
  if (!TAB_IDS.includes(tabId)) {
    tabId = 'dashboard';
  }
  document.querySelectorAll('.tab-page').forEach((el) => {
    el.classList.toggle('active', el.id === `tab-${tabId}`);
  });
  document.querySelectorAll('.nav-item').forEach((el) => {
    const active = el.dataset.tab === tabId;
    el.classList.toggle('active', active);
    if (active) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });
  if (['data-sensor', 'action-history'].includes(tabId)) {
    document.querySelector('.main-content').scrollTop = 0;
  }
  try {
    sessionStorage.setItem('activeTab', tabId);
  } catch {}
}

function restoreTab() {
  let tabId = 'dashboard';
  try {
    tabId = sessionStorage.getItem('activeTab') || tabId;
  } catch {}
  selectTab(tabId);
}

function switchTab(tabId) {
  if (!TAB_IDS.includes(tabId)) {
    return;
  }
  selectTab(tabId);
  if (tabId === 'data-sensor') {
    filterSensorData();
  }
  if (tabId === 'action-history') {
    filterActionData();
  }
  if (tabId === 'profile') {
    loadProfile().catch((error) => alert(error.message));
  }
}

function handlePaste(type) {
  setTimeout(
    () => (type === 'sensor' ? filterSensorData() : filterActionData()),
    0,
  );
}

function handleDebounce(type) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(
    () => (type === 'sensor' ? filterSensorData() : filterActionData()),
    300,
  );
}
