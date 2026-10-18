function initializeHistoryLayout() {
  const main = document.querySelector('.main-content');
  const pages = [...document.querySelectorAll('.history-page')];
  let frame;

  function fitTables() {
    for (const page of pages) {
      if (!page.classList.contains('active')) continue;
      const rows = [...page.querySelectorAll('tbody tr')];
      if (!rows.length || window.innerWidth <= 700) {
        page.style.removeProperty('--history-row-padding');
        continue;
      }

      const table = page.querySelector('.custom-table');
      const available =
        page.querySelector('.table-scroll').clientHeight -
        table.tHead.getBoundingClientRect().height -
        rows.length;
      const contentHeight = Math.max(
        ...rows.flatMap((row) => {
          return [...row.cells].map((cell) => {
            const styles = getComputedStyle(cell);
            const range = document.createRange();
            range.selectNodeContents(cell);
            return Math.max(
              parseFloat(styles.lineHeight),
              range.getBoundingClientRect().height,
            );
          });
        }),
      );
      const padding = Math.min(
        20,
        Math.max(3, Math.floor((available / rows.length - contentHeight) / 2)),
      );
      page.style.setProperty('--history-row-padding', `${padding}px`);
    }
  }

  function scheduleFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitTables);
  }

  const resize = new ResizeObserver(scheduleFit);
  resize.observe(main);
  for (const page of pages) {
    resize.observe(page);
    new MutationObserver(scheduleFit).observe(page.querySelector('tbody'), {
      childList: true,
    });
  }
  window.addEventListener('resize', scheduleFit);
  scheduleFit();
}
