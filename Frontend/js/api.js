const { API_BASE_URL, SOCKET_URL, DEVICE_ID, PAGE_SIZE, CHART_MAX_POINTS } =
  window.APP_CONFIG;
let authToken = null,
  currentUser = null,
  authMode = 'login',
  socket = null,
  combinedChart = null;
const LED_IDS = [1, 2, 3];
const ledStates = Object.fromEntries(LED_IDS.map((id) => [id, 'OFF']));
const pendingLeds = new Set();
const get = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[char],
  );
const formatDate = (value) =>
  value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString('vi-VN')
    : '—';

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Không thể kết nối Backend');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success === false) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      showLogin('Phiên đăng nhập đã hết hạn');
    }
    throw new Error(body?.message || `HTTP ${response.status}`);
  }
  return body;
}

function setLoading(id, loading, label) {
  const button = get(id);
  button.disabled = loading;
  button.textContent = loading ? 'Đang xử lý...' : label;
}

function showAuthMessage(text, success = false) {
  const box = get('login-error');
  box.textContent = `${success ? '✅' : '❌'} ${text}`;
  box.style.color = success ? '#059669' : '#e11d48';
  box.classList.add('show');
}

function clearSession() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('loginRunId');
  socket?.disconnect();
  socket = null;
}

function showLogin(message = '') {
  clearSession();
  get('login-overlay').classList.remove('hidden');
  if (message) {
    showAuthMessage(message);
  }
}
