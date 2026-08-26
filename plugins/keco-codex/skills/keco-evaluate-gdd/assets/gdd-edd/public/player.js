const params = new URLSearchParams(location.search);
const token = params.get('session');
const form = document.querySelector('#rating-form');
const message = document.querySelector('#page-message');
const submit = document.querySelector('#submit-rating');
const comment = document.querySelector('#comment');
const anonymousKey = token ? `edd-anonymous:${token}` : '';

function anonymousId() {
  let id = localStorage.getItem(anonymousKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(anonymousKey, id); }
  return id;
}

function setMessage(text, kind = '') { message.textContent = text; message.className = `message ${kind}`; }
function selected(name) { return form.querySelector(`input[name="${name}"]:checked`)?.value; }
function updateForm() {
  submit.disabled = !selected('experienceValueScore') || !selected('gameplaySystemsScore') || !selected('contentPresentationScore');
  document.querySelector('#experience-value-reasons').hidden = Number(selected('experienceValueScore')) > 3 || !selected('experienceValueScore');
  document.querySelector('#gameplay-systems-reasons').hidden = Number(selected('gameplaySystemsScore')) > 3 || !selected('gameplaySystemsScore');
  document.querySelector('#content-presentation-reasons').hidden = Number(selected('contentPresentationScore')) > 3 || !selected('contentPresentationScore');
}

async function load() {
  if (!token) return setMessage('Rating link is incomplete. Ask an administrator for the full link.', 'error');
  try {
    const response = await fetch(`/api/public/sessions/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    document.querySelector('#game-title').textContent = data.session.gameTitle;
    if (data.session.status !== 'open') return setMessage(data.session.status === 'closed' ? 'This rating session has ended.' : 'This rating link has expired.', 'error');
    form.hidden = false;
    setMessage(`Anonymous rating · ${data.session.aggregate.count} valid sample(s) so far`);
  } catch (error) { setMessage(error.message || 'Unable to load rating link.', 'error'); }
}

form.addEventListener('change', updateForm);
comment.addEventListener('input', () => { document.querySelector('#char-count').textContent = `${comment.value.length} / 300`; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = 'Submitting...';
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  const body = {
    anonymousId: anonymousId(),
    experienceValueScore: Number(selected('experienceValueScore')),
    gameplaySystemsScore: Number(selected('gameplaySystemsScore')),
    contentPresentationScore: Number(selected('contentPresentationScore')),
    experienceValueReasons: checked('experienceValueReasons'),
    gameplaySystemsReasons: checked('gameplaySystemsReasons'),
    contentPresentationReasons: checked('contentPresentationReasons'),
    comment: comment.value,
  };
  try {
    const response = await fetch(`/api/public/sessions/${encodeURIComponent(token)}/ratings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setMessage(`Submitted successfully. ${data.count} valid sample(s) so far; submit again to update your rating.`, 'success');
  } catch (error) { setMessage(error.message || 'Submission failed. Please try again later.', 'error'); }
  submit.textContent = 'Update rating';
  updateForm();
});

load();
