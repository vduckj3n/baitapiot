function renderPagination(prefix, p, pages) {
  const start = p.total ? (p.page - 1) * p.limit + 1 : 0,
    end = Math.min(p.page * p.limit, p.total);
  get(`${prefix}-page-info`).textContent =
    `Showing ${start}${p.total ? `-${end}` : ''} of ${p.total} records`;
  get(`${prefix}-page-number`).textContent = `Page ${p.page} / ${pages}`;
  get(`${prefix}-prev-page`).disabled = p.page <= 1;
  get(`${prefix}-next-page`).disabled = p.page >= pages;
}
