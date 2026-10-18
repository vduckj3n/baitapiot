// Apply the saved theme before CSS paints the page.
(() => {
  let theme = 'light';
  try {
    theme =
      localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');
  } catch {}
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
})();

function updateThemeControls() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('.theme-toggle').forEach((button) => {
    const label = `Chế độ ${dark ? 'sáng' : 'tối'}`;
    button.setAttribute('aria-label', `Bật ${label.toLowerCase()}`);
    button.setAttribute('aria-pressed', String(dark));
    button.querySelector('.theme-toggle-label').textContent = label;
    button.querySelector('.theme-toggle-icon').className =
      `fa-solid fa-${dark ? 'sun' : 'moon'} theme-toggle-icon`;
  });
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(
    document.documentElement,
  )
    .getPropertyValue('--bg-main')
    .trim();
}

function updateChartTheme() {
  if (typeof combinedChart === 'undefined' || !combinedChart) {
    return;
  }
  const styles = getComputedStyle(document.documentElement);
  const color = (name) => styles.getPropertyValue(name).trim();
  const scales = combinedChart.options.scales;
  ['x', 'yTempHum', 'yLight'].forEach((name) => {
    scales[name].ticks.color = color('--text-muted');
    scales[name].grid.color = color('--chart-grid');
    scales[name].grid.display = true;
    scales[name].grid.drawOnChartArea = name !== 'yLight';
  });
  scales.yTempHum.title.color = color('--text-muted');
  scales.yLight.title.color = scales.yLight.ticks.color =
    color('--light-color');
  combinedChart.options.plugins.legend.labels.color = color('--text-main');
  ['--temp-color', '--hum-color', '--light-color'].forEach((name, index) => {
    combinedChart.data.datasets[index].borderColor = color(name);
  });
  combinedChart.update('none');
}

function toggleTheme() {
  const theme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  updateThemeControls();
  updateChartTheme();
}
