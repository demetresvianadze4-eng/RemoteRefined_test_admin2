const $ = selector => document.querySelector(selector);
let reviews = [];

function setFeedback(element, message = '', type = '') {
  element.className = `feedback ${type}`;
  element.textContent = message;
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function safeImage(url) { return /^\/uploads\/[a-f0-9]+\.(?:png|jpe?g|webp)$/i.test(String(url || '')) ? url : ''; }

function renderList(selectedId = $('#reviewId').value) {
  $('#reviewCount').textContent = reviews.length;
  $('#reviewList').innerHTML = reviews.length ? reviews.map(review => {
    const photo = safeImage(review.imageUrl);
    return `<button type="button" class="${review.id === selectedId ? 'selected' : ''}" data-review-id="${review.id}"><span class="mini-thumb">${photo ? `<img src="${photo}" alt="">` : escapeHtml(review.art || '✦')}</span><span><strong>${escapeHtml(review.title)}</strong><small>${escapeHtml(review.category)} · ${Number(review.score).toFixed(1)}</small></span></button>`;
  }).join('') : '<p class="empty-list">No reviews yet. Create your first one.</p>';
  $('#reviewList').querySelectorAll('[data-review-id]').forEach(button => button.addEventListener('click', () => editReview(button.dataset.reviewId)));
}

function updatePhotoPreview(url = $('#imageUrlInput').value) {
  const image = safeImage(url);
  $('#imagePreview').classList.toggle('empty', !image);
  $('#previewImage').src = image || '';
  $('#imageFallback').textContent = $('#artInput').value || '✦';
  $('#removePhotoButton').classList.toggle('hidden', !image);
}

function blankEditor() {
  $('#reviewForm').reset();
  $('#reviewId').value = '';
  $('#scoreInput').value = '8.5';
  $('#artInput').value = '✦';
  $('#imageUrlInput').value = '';
  $('#photoInput').value = '';
  $('#editorTitle').textContent = 'Create a review';
  $('#deleteButton').classList.add('hidden');
  setFeedback($('#editorFeedback'));
  updatePhotoPreview('');
  renderList();
}

function editReview(id) {
  const review = reviews.find(item => item.id === id);
  if (!review) return;
  $('#reviewId').value = review.id;
  $('#titleInput').value = review.title;
  $('#categoryInput').value = review.category;
  $('#scoreInput').value = review.score;
  $('#artInput').value = review.art || '✦';
  $('#copyInput').value = review.copy;
  $('#imageUrlInput').value = safeImage(review.imageUrl);
  $('#photoInput').value = '';
  $('#editorTitle').textContent = 'Edit review';
  $('#deleteButton').classList.remove('hidden');
  setFeedback($('#editorFeedback'));
  updatePhotoPreview();
  renderList(review.id);
}

async function loadReviews() {
  const data = await request('/api/admin/reviews');
  reviews = data.reviews;
  renderList();
}

async function uploadPhoto(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP image smaller than 5 MB.');
  $('#uploadLabel').textContent = 'Uploading…';
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read that image.')); reader.readAsDataURL(file); });
  const data = await request('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
  $('#imageUrlInput').value = data.imageUrl;
  updatePhotoPreview(data.imageUrl);
  setFeedback($('#editorFeedback'), 'Photo uploaded. Save the review to publish it.', 'success');
}

async function showDashboard() {
  $('#loginPanel').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  await loadReviews();
  blankEditor();
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginForm button');
  button.disabled = true;
  setFeedback($('#loginFeedback'), 'Checking password…');
  try {
    await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#passwordInput').value }) });
    $('#passwordInput').value = '';
    await showDashboard();
  } catch (error) { setFeedback($('#loginFeedback'), error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#newReviewButton').addEventListener('click', blankEditor);
$('#artInput').addEventListener('input', () => updatePhotoPreview());
$('#removePhotoButton').addEventListener('click', () => { $('#imageUrlInput').value = ''; $('#photoInput').value = ''; updatePhotoPreview(''); });
$('#photoInput').addEventListener('change', async event => {
  try { await uploadPhoto(event.target.files[0]); }
  catch (error) { setFeedback($('#editorFeedback'), error.message, 'error'); }
  finally { $('#uploadLabel').textContent = 'Replace photo'; }
});

$('#reviewForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveButton');
  const id = $('#reviewId').value;
  const payload = { title: $('#titleInput').value, category: $('#categoryInput').value, score: $('#scoreInput').value, art: $('#artInput').value, copy: $('#copyInput').value, imageUrl: $('#imageUrlInput').value };
  button.disabled = true;
  setFeedback($('#editorFeedback'), 'Saving…');
  try {
    const data = await request(id ? `/api/admin/reviews/${id}` : '/api/admin/reviews', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const index = reviews.findIndex(review => review.id === data.review.id);
    if (index < 0) reviews.unshift(data.review); else reviews[index] = data.review;
    editReview(data.review.id);
    setFeedback($('#editorFeedback'), 'Review saved and live on the site.', 'success');
  } catch (error) { setFeedback($('#editorFeedback'), error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#deleteButton').addEventListener('click', async () => {
  const id = $('#reviewId').value;
  const review = reviews.find(item => item.id === id);
  if (!review || !confirm(`Delete “${review.title}”? This cannot be undone from the dashboard.`)) return;
  $('#deleteButton').disabled = true;
  try {
    await request(`/api/admin/reviews/${id}`, { method: 'DELETE' });
    reviews = reviews.filter(item => item.id !== id);
    blankEditor();
  } catch (error) { setFeedback($('#editorFeedback'), error.message, 'error'); }
  finally { $('#deleteButton').disabled = false; }
});

$('#logoutButton').addEventListener('click', async () => {
  await request('/api/admin/logout', { method: 'POST', body: '{}' });
  $('#dashboard').classList.add('hidden');
  $('#loginPanel').classList.remove('hidden');
  setFeedback($('#loginFeedback'));
});

(async () => {
  try {
    const session = await request('/api/admin/session');
    if (session.authenticated) await showDashboard();
    else if (!session.configured) setFeedback($('#loginFeedback'), 'Admin login is not configured yet. Add ADMIN_PASSWORD to .env, then restart the server.', 'error');
  } catch { setFeedback($('#loginFeedback'), 'Could not reach the site server. Start RemoteRefined and try again.', 'error'); }
})();
