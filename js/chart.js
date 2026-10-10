"use strict";

let chartInstance = null;

function renderChart(history, forecasts, unit) {
  const ctx = document.getElementById('detailChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  // Get the latest observed speed in knots to match map color scale
  const latestObsKnots = history.length > 0 ? history[history.length - 1].speed : 0;
  let dynamicColor = '#60c8ff';
  
  if (typeof getWindRGB === 'function') {
    const rgb = getWindRGB(latestObsKnots);
    dynamicColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Observed Wind',
          data: history.map(h => ({ x: h.time, y: h.speed * unit.factor })),
          borderColor: dynamicColor,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: 'AROME France HD',
          data: forecasts.arome.map(f => ({ x: f.time, y: f.speed * unit.factor })),
          borderColor: '#ff9f43',
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0
        },
        {
          label: 'ICON-EU',
          data: forecasts.icon.map(f => ({ x: f.time, y: f.speed * unit.factor })),
          borderColor: '#a55eea',
          borderWidth: 2,
          borderDash: [2, 2],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { hour: 'dd/MM HH:mm' } },
          ticks: { color: '#a4b3ca' },
          grid: { color: '#354258' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#a4b3ca' },
          grid: { color: '#354258' },
          title: { display: true, text: unit.label, color: '#a4b3ca' }
        }
      },
      plugins: {
        legend: { labels: { color: '#edf3ff', boxWidth: 12 } },
        zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
      }
    }
  });
}