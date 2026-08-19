(() => {
  const form = document.querySelector('#loginForm');
  const input = document.querySelector('#passwordInput');
  const button = document.querySelector('#loginButton');
  const error = document.querySelector('#loginError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '登录失败。');
      location.replace('/');
    } catch (loginError) {
      error.textContent = loginError instanceof Error ? loginError.message : String(loginError);
      input.select();
    } finally {
      button.disabled = false;
    }
  });
})();
