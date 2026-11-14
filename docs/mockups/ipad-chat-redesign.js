(function () {
  const viewButtons = document.querySelectorAll('[data-set-view]');
  const themeBtn = document.querySelector('[data-toggle-theme]');

  viewButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = btn.getAttribute('data-set-view');
      if (!target) return;
      document.body.setAttribute('data-view', target);
      viewButtons.forEach(function (other) {
        other.classList.toggle('is-active', other === btn);
      });
    });
  });

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const isLight = document.body.classList.contains('theme-light');
      document.body.classList.toggle('theme-light', !isLight);
      document.body.classList.toggle('theme-dark', isLight);
      themeBtn.textContent = isLight ? 'Switch to light theme' : 'Switch to dark theme';
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'states') {
    document.body.setAttribute('data-view', 'states');
  }
  if (params.get('theme') === 'light') {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
  }
  if (params.get('clean') === '1') {
    const bar = document.querySelector('.mock-control-bar');
    if (bar) bar.setAttribute('data-hidden', 'true');
  }
})();
