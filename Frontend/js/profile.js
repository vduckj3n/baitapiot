async function loadProfile() {
  // JWT chỉ cung cấp ID để tạo URL; backend kiểm tra token và quyền truy cập.
  let userId = currentUser?.id;
  if (!userId) {
    const payload = authToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    userId = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).id;
  }
  const { data: user } = await apiRequest(`/users/${userId}`);
  currentUser = user;
  for (const [key, id] of Object.entries({
    github: 'profile-github', figma: 'profile-figma', api_docs: 'profile-api-docs',
  })) {
    const link = get(id);
    link.removeAttribute('href');
    try {
      const url = new URL(user.links?.[key]);
      if (['http:', 'https:'].includes(url.protocol)) link.href = url.href;
    } catch {}
  }
  get('current-username').textContent = user.full_name;
  get('current-role').textContent = user.role;
  get('profile-full-name').textContent = user.full_name;
  document.querySelector('.user-avatar').src =
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=6366f1&color=fff`;
}
