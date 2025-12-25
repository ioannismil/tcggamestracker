// Fetch overall stats and render charts
async function loadOverallStats() {
  const res = await fetch('/api/stats/overall');
  if (!res.ok) return;
  const data = await res.json();

  // debug raw JSON removed (template no longer includes #statsRaw)

  // only per-tracker breakdowns are needed

  // Per-tracker breakdowns
  const container = document.getElementById('trackersBreakdown');
  container.innerHTML = '';
  const trackers = data.trackers || [];
  if (!trackers.length) {
    const msg = document.createElement('div');
    msg.className = 'stats-placeholder';
    msg.textContent = 'No per-tracker data available.';
    container.appendChild(msg);
  }
  trackers.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'tracker-card';
    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.style.marginBottom = '6px';
    title.textContent = `${t.tracker}`;
    const chartWrap = document.createElement('div');
    chartWrap.className = 'chart-container chart-small';
    const canvas = document.createElement('canvas');
    const cid = `trackerChart_${idx}`;
    canvas.id = cid;
    chartWrap.appendChild(canvas);
    card.appendChild(title);
    card.appendChild(chartWrap);
    container.appendChild(card);

    const ctx = canvas.getContext('2d');
    if (t.type === 'player') {
      const labels = (t.per_player || []).map(r => r.player_name);
      const dataPoints = (t.per_player || []).map(r => r.total_hits);
      new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Hits', data: dataPoints, backgroundColor: 'rgba(54,162,235,0.6)' }] }, options: { responsive: true, maintainAspectRatio: false } });
    } else if (t.type === 'yesno') {
      const yes = (t.yesno && t.yesno.yes) || 0;
      const no = (t.yesno && t.yesno.no) || 0;
      new Chart(ctx, { type: 'bar', data: { labels: ['Yes','No'], datasets: [{ label: 'Responses', data: [yes, no], backgroundColor: ['rgba(75,192,192,0.6)','rgba(255,99,132,0.6)'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    } else if (t.type === 'number') {
      const labels = (t.distribution || []).map(r => String(r.value));
      const dataPoints = (t.distribution || []).map(r => r.occurrences);
      new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Occurrences', data: dataPoints, backgroundColor: 'rgba(153,102,255,0.6)' }] }, options: { responsive: true, maintainAspectRatio: false } });
    }
  });
}

document.addEventListener('DOMContentLoaded', loadOverallStats);
