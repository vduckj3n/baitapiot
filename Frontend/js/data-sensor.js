let sensorPage = 1,
  sensorPages = 1,
  sensorKey = '',
  sensorLimit = PAGE_SIZE;

async function filterSensorData() {
  const searchBy = get('sensor-search-attr').value.toLowerCase(),
    search = get('sensor-search-input').value.trim(),
    type = get('sensor-type-filter').value,
    sort = get('sensor-sort').value.toLowerCase();
  const key = `${searchBy}|${search}|${type}|${sort}`;
  if (key !== sensorKey) {
    sensorPage = 1;
    sensorKey = key;
  }
  const query = new URLSearchParams({
    page: sensorPage,
    limit: sensorLimit,
    searchBy,
    search,
    sort,
  });
  if (type !== 'ALL') {
    query.set('type', type);
  }
  try {
    const result = await apiRequest(`/sensors/data?${query}`);
    renderSensorTable(result.data, result.pagination);
  } catch (error) {
    renderSensorTable([], {
      page: 1,
      limit: sensorLimit,
      total: 0,
      totalPages: 0,
    });
    alert(error.message);
  }
}

function sensorIcon(type) {
  return type === 'Temperature'
    ? ['fa-temperature-high', 'icon-temp']
    : type === 'Humidity'
      ? ['fa-droplet', 'icon-hum']
      : ['fa-sun', 'icon-light'];
}

function renderSensorTable(rows, p) {
  get('sensor-tbody').innerHTML = rows.length
    ? rows
        .map((row) => {
          const [icon, color] = sensorIcon(row.sensor_type);
          return `<tr><td><strong>${row.id}</strong></td><td><i class="fa-solid ${icon} ${color}"></i>${escapeHtml(row.sensor_name)}</td><td>${escapeHtml(row.sensor_type)}</td><td><strong>${escapeHtml(row.value)} ${escapeHtml(row.unit)}</strong></td><td><span class="badge-pill badge-normal">${escapeHtml(row.status)}</span></td><td>${escapeHtml(formatDate(row.timestamp))}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="empty-row">No data</td></tr>';
  sensorPage = p.page;
  sensorPages = Math.max(1, p.totalPages);
  renderPagination('sensor', p, sensorPages);
}

function changeSensorPage(direction) {
  const next = sensorPage + direction;
  if (next >= 1 && next <= sensorPages) {
    sensorPage = next;
    filterSensorData();
  }
}

function changeSensorPageLimit(value) {
  const limit = Number(value);
  if (![5, 10].includes(limit)) {
    return;
  }
  sensorLimit = limit;
  sensorPage = 1;
  filterSensorData();
}
