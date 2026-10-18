let actionPage = 1,
  actionPages = 1,
  actionKey = '',
  actionLimit = PAGE_SIZE;

async function filterActionData() {
  const searchBy = 'timestamp',
    search = get('action-search-input').value.trim(),
    deviceId = get('action-device-filter').value,
    action = get('action-filter').value,
    status = get('action-status-filter').value,
    sort = get('action-sort').value.toLowerCase();
  const key = `${search}|${deviceId}|${action}|${status}|${sort}`;
  if (key !== actionKey) {
    actionPage = 1;
    actionKey = key;
  }
  const query = new URLSearchParams({
    page: actionPage,
    limit: actionLimit,
    searchBy,
    search,
    sort,
  });
  if (deviceId !== 'ALL') {
    query.set('deviceId', deviceId);
  }
  if (action !== 'ALL') {
    query.set('action', action);
  }
  if (status !== 'ALL') {
    query.set('status', status);
  }
  try {
    const result = await apiRequest(`/actions?${query}`);
    renderActionTable(result.data, result.pagination);
  } catch (error) {
    renderActionTable([], {
      page: 1,
      limit: actionLimit,
      total: 0,
      totalPages: 0,
    });
    alert(error.message);
  }
}

function renderActionTable(rows, p) {
  get('action-tbody').innerHTML = rows.length
    ? rows
        .map((row) => {
          const badge =
            row.status === 'FAILED'
              ? 'badge-failed'
              : row.status === 'PENDING'
                ? 'badge-pending'
                : 'badge-success';
          return `<tr><td>${row.id}</td><td><i class="fa-solid fa-lightbulb icon-light"></i>${escapeHtml(row.device_name)}</td><td><strong>${escapeHtml(row.action)}</strong></td><td><span class="badge-pill ${badge}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(formatDate(row.timestamp))}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="5" class="empty-row">No data</td></tr>';
  actionPage = p.page;
  actionPages = Math.max(1, p.totalPages);
  renderPagination('action', p, actionPages);
}

function changeActionPage(direction) {
  const next = actionPage + direction;
  if (next >= 1 && next <= actionPages) {
    actionPage = next;
    filterActionData();
  }
}

function changeActionPageLimit(value) {
  const limit = Number(value);
  if (![5, 10].includes(limit)) {
    return;
  }
  actionLimit = limit;
  actionPage = 1;
  filterActionData();
}
