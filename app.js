let reviews = [];

const categoryDetails = {
  chairs: { name: 'Ergonomic chairs', lead: 'Chairs that support the work you do — and the life you live around it.', accent: '#e2e2df' },
  desks: { name: 'Standing desks', lead: 'Thoughtful desks that help your workspace move with the rhythm of your day.', accent: '#dfb48e' },
  video: { name: 'Cameras & calls', lead: 'The small things that make distance feel more personal, polished, and present.', accent: '#abd4d1' },
  software: { name: 'Productivity software', lead: 'Digital tools that protect your focus instead of competing for it.', accent: '#c7c0ff' },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function safeImageUrl(value) {
  return /^\/uploads\/[a-f0-9]+\.(?:png|jpe?g|webp)$/i.test(String(value || '')) ? value : '';
}

function reviewRow(review) {
  const detail = categoryDetails[review.category] || categoryDetails.chairs;
  const imageUrl = safeImageUrl(review.imageUrl);
  const visual = imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(review.title)}">` : escapeHtml(review.art || '✦');
  return `<a class="review-row" href="search.html?q=${encodeURIComponent(review.title)}"><span class="review-art ${imageUrl ? 'has-photo' : ''}" style="--art:${detail.accent}">${visual}</span><span><h3>${escapeHtml(review.title)}</h3><p>${escapeHtml(review.copy)}</p></span><span class="review-score"><b>${Number(review.score).toFixed(1)}</b>Score</span><span class="row-arrow">↗</span></a>`;
}

function setupEmailForms() {
  document.querySelectorAll('[data-subscribe]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const feedback = form.querySelector('.form-feedback');
      const button = form.querySelector('button');
      feedback.className = 'form-feedback';
      feedback.textContent = 'Sending your hello…';
      button.disabled = true;
      try {
        const response = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value, source: form.dataset.subscribe }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Something went wrong.');
        feedback.classList.add('success');
        feedback.textContent = result.message;
        input.value = '';
      } catch (error) {
        feedback.classList.add('error');
        feedback.textContent = error.message;
      } finally { button.disabled = false; }
    });
  });
}

function setupMobileMenu() {
  const button = document.querySelector('.mobile-toggle');
  const links = document.querySelector('.nav-links');
  if (!button || !links) return;
  button.addEventListener('click', () => { const open = links.classList.toggle('open'); button.setAttribute('aria-expanded', String(open)); });
}

function setupReveals() {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), { threshold: .1 });
  document.querySelectorAll('.reveal').forEach(item => observer.observe(item));
}

function setupCategoryPage() {
  const category = document.body.dataset.category;
  if (!category || !categoryDetails[category]) return;
  const detail = categoryDetails[category];
  document.title = `${detail.name} — RemoteRefined`;
  document.querySelector('[data-category-name]').textContent = detail.name;
  document.querySelector('[data-category-lead]').textContent = detail.lead;
  const matchingReviews = reviews.filter(review => review.category === category);
  document.querySelector('#reviewList').innerHTML = matchingReviews.length ? matchingReviews.map(reviewRow).join('') : '<p class="empty-public-list">No reviews in this category yet. Check back soon.</p>';
}

function setupSearchPage() {
  const results = document.querySelector('#searchResults');
  if (!results) return;
  const params = new URLSearchParams(location.search);
  const query = (params.get('q') || '').trim();
  const input = document.querySelector('#searchInput');
  input.value = query;
  const matches = query ? reviews.filter(item => `${item.title} ${item.category} ${item.copy}`.toLowerCase().includes(query.toLowerCase())) : reviews;
  document.querySelector('#resultLabel').textContent = query ? `${matches.length} result${matches.length === 1 ? '' : 's'} for “${query}”` : 'Start with a category or a product name';
  results.innerHTML = matches.length ? matches.map(reviewRow).join('') : '<div class="review-row"><span class="review-art">?</span><span><h3>No exact match yet.</h3><p>Try “chair”, “desk”, “camera”, or “software”.</p></span><span></span><span></span></div>';
}

async function loadReviews() {
  try {
    const response = await fetch('/api/reviews');
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.reviews)) throw new Error('Could not load reviews.');
    reviews = data.reviews;
  } catch (error) {
    console.error(error);
    const list = document.querySelector('#reviewList, #searchResults');
    if (list) list.innerHTML = '<p class="empty-public-list">Reviews are unavailable right now. Please refresh shortly.</p>';
  }
}

async function initializeSite() {
  setupEmailForms();
  setupMobileMenu();
  setupReveals();
  await loadReviews();
  setupCategoryPage();
  setupSearchPage();
}

initializeSite();
