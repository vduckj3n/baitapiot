function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  get('login-form').classList.toggle('hidden', authMode !== 'login');
  get('register-form').classList.toggle('hidden', authMode !== 'register');
  get('auth-switch-button').textContent =
    authMode === 'login'
      ? 'Chưa có tài khoản? Đăng ký'
      : 'Đã có tài khoản? Đăng nhập';
  get('login-error').classList.remove('show');
}

async function handleLogin(event) {
  event.preventDefault();
  setLoading('login-submit', true, 'Đăng nhập');
  get('login-error').classList.remove('show');
  try {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: get('login-username').value.trim(),
        password: get('login-password').value,
      }),
    });
    authToken = result.token;
    currentUser = result.user;
    saveSession();
    await initializeApp();
    get('login-overlay').classList.add('hidden');
    get('login-form').reset();
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setLoading('login-submit', false, 'Đăng nhập');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  setLoading('register-submit', true, 'Đăng ký');
  try {
    await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: get('register-full-name').value.trim(),
        username: get('register-username').value.trim(),
        email: get('register-email').value.trim(),
        password: get('register-password').value,
      }),
    });
    const username = get('register-username').value.trim();
    get('register-form').reset();
    toggleAuthMode();
    get('login-username').value = username;
    showAuthMessage('Đăng ký thành công, hãy đăng nhập', true);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setLoading('register-submit', false, 'Đăng ký');
  }
}

function handleLogout() {
  if (confirm('Bạn có chắc muốn đăng xuất?')) {
    clearSession();
    window.location.reload();
  }
}
