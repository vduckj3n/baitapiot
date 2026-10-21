const ledRevisions = Object.fromEntries(LED_IDS.map((id) => [id, 0]));
let dashboardRequest = 0;
let connectionRevision = 0;

function initChart(history = []) {
  combinedChart?.destroy();
  combinedChart = new Chart(get('realtimeCombinedChart'), {
    type: 'line',
    data: {
      labels: history.map((row) =>
        new Date(row.timestamp).toLocaleTimeString('vi-VN'),
      ),
      datasets: [
        {
          label: 'Nhiệt độ (°C)',
          borderColor: '#ef4444',
          data: history.map((row) => row.temperature),
          yAxisID: 'yTempHum',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
        },
        {
          label: 'Độ ẩm (%)',
          borderColor: '#0284c7',
          data: history.map((row) => row.humidity),
          yAxisID: 'yTempHum',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
        },
        {
          label: 'Ánh sáng (Lux)',
          borderColor: '#d97706',
          data: history.map((row) => row.light),
          yAxisID: 'yLight',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: true, drawOnChartArea: true }, ticks: {} },
        yTempHum: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Nhiệt độ (°C) / Độ ẩm (%)',
            font: { size: 11 },
          },
          grid: { display: true, drawOnChartArea: true },
          ticks: {},
        },
        yLight: {
          min: 0,
          max: 1000,
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Ánh sáng (Lux)', font: { size: 11 } },
          grid: { display: true, drawOnChartArea: false },
          ticks: {},
        },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 12, weight: '600' },
            usePointStyle: true,
            boxWidth: 8,
          },
        },
      },
    },
  });
  updateChartTheme();
}

function renderLed(ledId, state, pending = false) {
  if (!LED_IDS.includes(ledId)) return;
  ledRevisions[ledId]++;
  ledStates[ledId] = state === 'ON' ? 'ON' : 'OFF';
  pending ? pendingLeds.add(ledId) : pendingLeds.delete(ledId);
  const button = get(`btn-led-${ledId}`);
  const on = ledStates[ledId] === 'ON';
  get(`led-icon-${ledId}`).classList.toggle('active', on);
  button.disabled = pending;
  button.className = `btn-led-toggle ${on ? 'on' : 'off'}`;
  button.textContent = pending ? 'Processing...' : on ? 'Turn OFF' : 'Turn ON';
  get(`led-status-${ledId}`).textContent = pending
    ? `Status: PENDING (${ledStates[ledId]})`
    : `Status: ${ledStates[ledId]}`;
}

function renderDevice(status) {
  connectionRevision++;
  const el = get('device-connection'),
    value = status === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
  el.textContent = value;
  el.className = `connection-status ${value.toLowerCase()}`;
}

async function loadDashboard() {
  const request = ++dashboardRequest;
  const revisions = { ...ledRevisions };
  const connection = connectionRevision;
  const { data } = await apiRequest(`/dashboard/summary?deviceId=${DEVICE_ID}`);
  if (request !== dashboardRequest) return;
  if (connection === connectionRevision) renderDevice(data.device.status);
  for (const led of data.leds) {
    const ledId = Number(led.id);
    if (revisions[ledId] === ledRevisions[ledId]) {
      renderLed(ledId, led.state, Boolean(led.pending));
    }
  }
  if (data.latest) {
    get('val-temp').textContent = `${data.latest.temperature} °C`;
    get('val-hum').textContent = `${data.latest.humidity} %`;
    get('val-light').textContent = `${data.latest.light} Lux`;
  } else {
    ['val-temp', 'val-hum', 'val-light'].forEach(
      (id) => (get(id).textContent = 'No data'),
    );
  }
  const history = (data.history || []).slice(-CHART_MAX_POINTS);
  if (!combinedChart) {
    initChart(history);
  } else {
    combinedChart.data.labels = history.map((row) =>
      new Date(row.timestamp).toLocaleTimeString('vi-VN'),
    );
    ['temperature', 'humidity', 'light'].forEach((key, index) => {
      combinedChart.data.datasets[index].data = history.map((row) => row[key]);
    });
    combinedChart.update('none');
  }
}

async function toggleLED(ledId) {
  if (!LED_IDS.includes(ledId) || pendingLeds.has(ledId)) {
    return;
  }
  const command = ledStates[ledId] === 'ON' ? 'OFF' : 'ON';
  renderLed(ledId, ledStates[ledId], true);
  try {
    await apiRequest(`/devices/${ledId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
    filterActionData();
  } catch (error) {
    renderLed(ledId, ledStates[ledId]);
    alert(error.message);
    filterActionData();
  }
}

async function refreshDashboard() {
  try {
    await loadDashboard();
  } catch (error) {
    get('live-label').textContent = 'UPDATE FAILED';
    console.error('Không cập nhật được dashboard:', error.message);
  }
}

function connectSocket() {
  if (typeof io !== 'function') {
    get('live-label').textContent = 'SOCKET UNAVAILABLE';
    return;
  }
  socket?.disconnect();
  socket = io(SOCKET_URL, {
    auth: { token: authToken },
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    get('live-label').textContent = 'LIVE';
    refreshDashboard();
    filterActionData();
  });
  socket.on(
    'disconnect',
    () => (get('live-label').textContent = 'DISCONNECTED'),
  );
  socket.on('sensor_data', (data) => {
    if (Number(data.device_id) === DEVICE_ID) {
      refreshDashboard();
    }
  });
  socket.on('device_response', (data) => {
    const ledId = Number(data.device_id);
    if (LED_IDS.includes(ledId)) {
      renderLed(ledId, data.status === 'SUCCESS' ? data.led_state : ledStates[ledId]);
      filterActionData();
    }
  });
  socket.on('device_status', (data) => {
    if (Number(data.device_id) === DEVICE_ID) {
      renderDevice(data.connection_status);
    }
    const ledId = Number(data.device_id);
    if (LED_IDS.includes(ledId) && data.led_state) {
      renderLed(ledId, data.led_state, pendingLeds.has(ledId));
    }
  });
}
