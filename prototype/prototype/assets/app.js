// Eventa prototype — tiny interactivity (no backend)
document.addEventListener('click', (e) => {
  // Tab switching
  const tab = e.target.closest('.tabs button[data-tab]');
  if (tab) {
    const wrap = tab.closest('[data-tabs]') || document;
    wrap.querySelectorAll('.tabs button[data-tab]').forEach(b => b.classList.remove('active'));
    wrap.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = wrap.querySelector('#' + tab.dataset.tab);
    if (panel) panel.classList.add('active');
  }
});

// Live-filter any table with a [data-filter] search box in its toolbar
document.querySelectorAll('input[data-filter]').forEach(inp => {
  inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    const rows = document.querySelector(inp.dataset.filter).querySelectorAll('tbody tr');
    rows.forEach(r => r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none');
  });
});
