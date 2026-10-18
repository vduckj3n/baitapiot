let currentRunId = null;

async function loadRunId() {
  const response = await fetch('runtime-session.json', { cache: 'no-store' });
  // Live Server / standalone HTTP previews do not create a runtime marker.
  if (response.status === 404) {
    return 'standalone';
  }
  if (!response.ok) {
    throw new Error('Không đọc được phiên chạy hệ thống');
  }
  const session = await response.json();
  if (typeof session.id !== 'string' || !session.id) {
    throw new Error('Phiên chạy hệ thống không hợp lệ');
  }
  return session.id;
}

function saveSession() {
  localStorage.setItem('token', authToken);
  localStorage.setItem('loginRunId', currentRunId);
}

async function initializeApp() {
  await loadProfile();
  await Promise.all([loadDashboard(), filterSensorData(), filterActionData()]);
  connectSocket();
}

const PAGE_FILES = ['dashboard', 'data-sensor', 'action-history', 'profile'];

async function loadPages() {
  const pages = await Promise.all(
    PAGE_FILES.map(async (name) => {
      const response = await fetch(`pages/${name}.html`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Không tải được trang ${name} (${response.status})`);
      }
      return response.text();
    }),
  );
  document.querySelector('.main-content').innerHTML = pages.join('\n');
  restoreTab();
  ['sensor', 'action'].forEach((prefix) => {
    get(`${prefix}-page-limit`).value = String(PAGE_SIZE);
  });
  initializeHistoryLayout();
}

window.addEventListener('load', async () => {
  updateThemeControls();
  try {
    await loadPages();
    currentRunId = await loadRunId();
  } catch (error) {
    document.querySelector('.main-content').textContent = error.message;
    showAuthMessage(
      `${error.message}. Hãy chạy frontend bằng HTTP server và tải lại trang.`,
    );
    return;
  } finally {
    document.querySelector('.main-content').setAttribute('aria-busy', 'false');
  }
  document.querySelectorAll('.nav-menu, .login-form').forEach((el) => {
    el.inert = false;
  });
  if (localStorage.getItem('loginRunId') !== currentRunId) {
    showLogin();
    return;
  }
  authToken = localStorage.getItem('token');
  if (!authToken) {
    showLogin();
    return;
  }
  try {
    await initializeApp();
    get('login-overlay').classList.add('hidden');
  } catch (error) {
    showLogin(error.message);
  }
});
