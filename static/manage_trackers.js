async function loadManaged() {
  const res = await fetch('/api/managed_trackers');
  const list = await res.json();
  const container = document.getElementById('managed-list');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = '<p>No managed trackers yet.</p>';
    return;
  }

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <span style="flex:1">${item.tracker} <span class="stats-badge">${item.type}</span></span>
      <button data-id="${item.id}" class="btn edit">Edit</button>
      <button data-id="${item.id}" class="btn delete">Delete</button>
    `;
    container.appendChild(div);
  });

  // attach handlers
  container.querySelectorAll('button.edit').forEach(b => {
    b.onclick = async (e) => {
      const id = e.target.dataset.id;
      const name = prompt('New name');
      if (name === null) return;
      const type = prompt('Type (player, yesno, number)');
      if (type === null) return;
      await fetch(`/api/managed_trackers/${id}`, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({tracker: name, type})
      });
      await loadManaged();
    }
  });

  container.querySelectorAll('button.delete').forEach(b => {
    b.onclick = async (e) => {
      const id = e.target.dataset.id;
      if (!confirm('Delete this managed tracker?')) return;
      await fetch(`/api/managed_trackers/${id}`, { method: 'DELETE' });
      await loadManaged();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('mt-add').onclick = async () => {
    const name = document.getElementById('mt-name').value.trim();
    const type = document.getElementById('mt-type').value;
    if (!name) return;
    await fetch('/api/managed_trackers', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({tracker: name, type})
    });
    document.getElementById('mt-name').value = '';
    await loadManaged();
  };
  loadManaged();
});
