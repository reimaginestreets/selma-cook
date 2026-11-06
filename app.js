// Selma — a slow kitchen journal.
// What you made and when, so the usual recipes can be spaced out; a line-up for the week ahead,
// and its ingredients gathered into a shopping list for the store.
// Everything is stored in this browser (localStorage); there is no server.

const STORE_KEY = 'selma-cook.v1';
const BACKUP_KEY = 'selma-cook.backup'; // the day the last backup was saved

// A heart drawn in line, so it looks the same on every device; filled for a keeper.
const HEART = '<svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';

// A dish made within this many days counts as recent: it sits quieter in the line-up picker,
// and "Pick one for me" passes over it.
const RESTING_DAYS = 7;

const state = loadState();
const filter = { q: '', keepers: false, sort: 'az' };
let view = 'week';
let openDish = null;  // the key of the dish card that is open
let picked = null;    // the key of the dish Selma suggested
let month = dayKey().slice(0, 7); // the month the calendar shows, as YYYY-MM

const $ = (sel) => document.querySelector(sel);
const dishDialog = $('#dish-dialog');
const mealDialog = $('#meal-dialog');
const mealForm = $('#meal-form');
const recipeDialog = $('#recipe-dialog');
const recipeForm = $('#recipe-form');

function blankState() {
  // meals: [{ id, dish, day, from, note, at }]
  // recipes: { dishKey: { name, from, ingredients: [line], method } }
  // keepers: dish keys to make again; lineup: dish keys planned for the days ahead
  // shopping: { got: [item keys ticked off], extras: [{ id, text, got }] }
  return { meals: [], recipes: {}, keepers: [], lineup: [], shopping: { got: [], extras: [] } };
}

function loadState() {
  try {
    return { ...blankState(), ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return blankState();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('This browser would not save that.');
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}
function addDays(key, n) {
  const date = keyDate(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}
const thisYear = (key) => key.startsWith(String(new Date().getFullYear()));
const longDate = (key) => keyDate(key).toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(thisYear(key) ? {} : { year: 'numeric' }) });
const shortDay = (key) => keyDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const daysBetween = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 864e5);

// Weeks start on Monday.
function mondayOf(key) {
  const date = keyDate(key);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayKey(date);
}

// The same dish however it was typed: lower case, single spaces.
const dishKey = (name) => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

const newestFirst = (a, b) => b.day.localeCompare(a.day) || b.at - a.at;

// Every dish: each recipe, and anything made without one. Meals are newest first;
// the name is the recipe's, or as last typed.
function dishes() {
  const out = new Map();
  for (const [key, recipe] of Object.entries(state.recipes)) out.set(key, { key, name: recipe.name, recipe, meals: [] });
  for (const meal of [...state.meals].sort(newestFirst)) {
    const key = dishKey(meal.dish);
    if (!out.has(key)) out.set(key, { key, name: meal.dish, recipe: null, meals: [] });
    out.get(key).meals.push(meal);
  }
  return out;
}
const isKeeper = (key) => state.keepers.includes(key);
function setKeeper(key, on) {
  state.keepers = state.keepers.filter((k) => k !== key);
  if (on) state.keepers.push(key);
}

// Days since a dish was last made (made today is 0), or null if it hasn't been yet.
const daysSince = (dish) => (dish.meals.length ? daysBetween(dish.meals[0].day, dayKey()) : null);
function sinceText(dish) {
  const n = daysSince(dish);
  if (n === null) return 'Not made yet';
  if (n <= 0) return 'Made today';
  if (n === 1) return 'Made yesterday';
  return `Made ${n} days ago`;
}

// Where a recipe came from: the recipe's own note, or the most recent one given when it was made.
const fromOf = (dish) => dish.recipe?.from || dish.meals.find((m) => m.from)?.from || '';
const lastNote = (dish) => dish.meals.find((m) => m.note);
const madeItUp = (from) => /^(made|my own|improvis|winged)/i.test(from);

// Where a recipe came from, short enough for a list: a web address shows as its site,
// and "made it up" needs no "from".
function fromLine(from) {
  const site = from.replace(/^https?:\/\/(www\.)?([^/]+).*$/i, '$2');
  return madeItUp(site) ? site : `from ${site}`;
}

// A recipe that is a web address becomes a link.
function fromHTML(from) {
  if (/^https?:\/\/\S+$/i.test(from)) {
    const host = new URL(from).hostname.replace(/^www\./, '');
    return `<a href="${esc(from)}" target="_blank" rel="noopener">${esc(host)}</a>`;
  }
  return esc(from);
}

// The line-up only holds dishes that still exist; the shopping list only remembers ticks for them.
function tidy() {
  const known = dishes();
  state.keepers = state.keepers.filter((k) => known.has(k));
  state.lineup = state.lineup.filter((k) => known.has(k));
  state.shopping.got = state.shopping.got.filter((item) => state.lineup.includes(item.split('|')[0]));
}

// Giving a dish a new name carries its meals, heart and place in the line-up along with it.
function rename(oldKey, name) {
  const key = dishKey(name);
  for (const meal of state.meals) if (dishKey(meal.dish) === oldKey) meal.dish = name;
  if (key === oldKey) return;
  if (state.recipes[oldKey]) {
    state.recipes[key] = state.recipes[oldKey];
    delete state.recipes[oldKey];
  }
  const swap = (k) => (k === oldKey ? key : k);
  state.keepers = [...new Set(state.keepers.map(swap))];
  state.lineup = [...new Set(state.lineup.map(swap))];
  state.shopping.got = state.shopping.got.map((item) => item.startsWith(oldKey + '|') ? key + item.slice(oldKey.length) : item);
}

/* ---------- This week ---------- */

function dayCellHTML(day, meals) {
  const today = day === dayKey();
  const date = keyDate(day);
  return `<li class="day-cell${today ? ' today' : ''}">
    <p class="dname"><b>${today ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })}</b> ${date.getDate()}</p>
    ${meals.map((m) => `<button class="dish-chip" data-action="open-dish" data-key="${esc(dishKey(m.dish))}">${esc(m.dish)}</button>`).join('')}
    ${meals.length ? '' : `<button class="add-day" data-action="add-meal" data-day="${day}" aria-label="What did you make on ${esc(shortDay(day))}?">+</button>`}
  </li>`;
}

function renderWeek() {
  $('#nudges').innerHTML = backupDue()
    ? `<p class="nudge">${localStorage.getItem(BACKUP_KEY) ? 'It has been a while since the last backup.' : 'This journal has not been backed up yet.'}
        <button class="link" data-action="export">Save a backup</button><button class="link" data-action="backup-later">Later</button></p>`
    : '';
  const all = dishes();
  if (!all.size) {
    $('#week').innerHTML = `<div class="empty">
      <img src="selma-cook.svg" width="96" height="96" alt="">
      <h2>A clean kitchen, for now</h2>
      <p>Put your usual recipes in the recipe box, with their ingredients, or tell Selma about the last thing you cooked.</p>
      <button class="btn primary" data-action="add-recipe">Add a recipe</button>
      <button class="btn quiet" data-action="add-meal">I made something</button>
    </div>`;
    return;
  }

  // The past seven days, ending today.
  const today = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const strip = days.map((day) => dayCellHTML(day, state.meals.filter((m) => m.day === day).sort((a, b) => a.at - b.at))).join('');

  // The line-up, and every other dish to choose from, longest since it was made first.
  const lineup = state.lineup.map((k) => all.get(k)).filter(Boolean);
  const longestFirst = (a, b) => (daysSince(b) ?? 1e6) - (daysSince(a) ?? 1e6) || a.name.localeCompare(b.name);
  const others = [...all.values()].filter((d) => !state.lineup.includes(d.key)).sort(longestFirst);

  $('#week').innerHTML = `
    <section class="block">
      <div class="block-head">
        <h2>The past week</h2>
        <button class="btn primary" data-action="add-meal">I made something</button>
      </div>
      <ol class="strip">${strip}</ol>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>The line-up</h2>
        ${lineup.length ? '<button class="btn quiet" data-view-go="shop">Shopping list →</button>' : ''}
      </div>
      ${lineup.length ? `<ul class="lineup">${lineup.map((d) => `<li>
          <button class="lname" data-action="open-dish" data-key="${esc(d.key)}">${esc(d.name)}${isKeeper(d.key) ? ` <span class="keeper">${HEART}</span>` : ''}</button>
          <span class="since">${esc(sinceText(d))}</span>
          <span class="row-tools">
            <button class="btn small" data-action="made-it" data-key="${esc(d.key)}">Made it</button>
            <button class="btn danger" data-action="unplan" data-key="${esc(d.key)}" aria-label="Take ${esc(d.name)} out of the line-up">Take out</button>
          </span>
        </li>`).join('')}</ul>`
        : '<p class="quiet-line">Nothing lined up yet. Choose a few dishes below for the days ahead; their ingredients go on the shopping list.</p>'}
      ${others.length ? `<p class="choose-label">Add to the line-up <span class="optional">longest since you made it first</span></p>
        <div class="choices">${others.map((d) => {
          const n = daysSince(d);
          return `<button class="choice${n !== null && n < RESTING_DAYS ? ' recent' : ''}" data-action="plan" data-key="${esc(d.key)}">
            <span class="cname">+ ${esc(d.name)}</span><span class="since">${esc(n === null ? 'not made yet' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days`)}</span>
          </button>`;
        }).join('')}</div>` : ''}
    </section>`;
}

/* ---------- Shopping ---------- */

const itemKey = (key, line) => `${key}|${line.toLowerCase().trim()}`;

function renderShop() {
  const all = dishes();
  const lineup = state.lineup.map((k) => all.get(k)).filter(Boolean);
  const got = new Set(state.shopping.got);
  const itemHTML = (key, line) => {
    const id = itemKey(key, line);
    return `<li><label class="item${got.has(id) ? ' got' : ''}"><input type="checkbox" data-item="${esc(id)}" ${got.has(id) ? 'checked' : ''}><span>${esc(line)}</span></label></li>`;
  };
  // Unticked first, so what's left to find stays at the top.
  const ordered = (key, lines) => [...lines].sort((a, b) => got.has(itemKey(key, a)) - got.has(itemKey(key, b)));
  const extras = [...state.shopping.extras].sort((a, b) => a.got - b.got);

  $('#shop').innerHTML = `
    ${lineup.length ? '' : `<p class="quiet-line">Line up a few dishes on <button class="link" data-view-go="week">This week</button> and their ingredients gather here.</p>`}
    ${lineup.map((d) => {
      const lines = d.recipe?.ingredients || [];
      return `<section class="shop-dish">
        <h2><button data-action="open-dish" data-key="${esc(d.key)}">${esc(d.name)}</button></h2>
        ${lines.length ? `<ul class="items">${ordered(d.key, lines).map((l) => itemHTML(d.key, l)).join('')}</ul>`
          : `<p class="quiet-line">No ingredients yet. <button class="link" data-action="edit-recipe" data-key="${esc(d.key)}">Add them</button></p>`}
      </section>`;
    }).join('')}
    <section class="shop-dish">
      <h2>Anything else</h2>
      ${extras.length ? `<ul class="items">${extras.map((x) => `<li><label class="item${x.got ? ' got' : ''}"><input type="checkbox" data-extra="${x.id}" ${x.got ? 'checked' : ''}><span>${esc(x.text)}</span></label>
        <button class="btn danger" data-action="remove-extra" data-id="${x.id}" aria-label="Remove ${esc(x.text)}">×</button></li>`).join('')}</ul>` : ''}
      <form class="add-extra" id="extra-form">
        <input name="text" autocomplete="off" maxlength="120" placeholder="e.g., milk, coffee, dish soap" aria-label="Something else to buy">
        <button class="btn" type="submit">Add</button>
      </form>
    </section>
    ${lineup.length || extras.length ? `<div class="shop-tools">
      <button class="btn quiet" data-action="copy-list">Copy the list</button>
      <button class="btn quiet" data-action="untick">Untick everything</button>
      ${extras.some((x) => x.got) ? '<button class="btn quiet" data-action="clear-extras">Clear ticked extras</button>' : ''}
    </div>` : ''}`;
}

// The list as plain text, for a notes app or a message: only what is still to get.
function listText() {
  const all = dishes();
  const got = new Set(state.shopping.got);
  const lines = [];
  for (const key of state.lineup) {
    const dish = all.get(key);
    const left = (dish?.recipe?.ingredients || []).filter((l) => !got.has(itemKey(key, l)));
    if (left.length) lines.push(`${dish.name}:`, ...left.map((l) => `- ${l}`), '');
  }
  const extras = state.shopping.extras.filter((x) => !x.got);
  if (extras.length) lines.push('Anything else:', ...extras.map((x) => `- ${x.text}`));
  return lines.join('\n').trim();
}

/* ---------- Calendar ---------- */

function renderCalendar() {
  const first = keyDate(month + '-01');
  const start = mondayOf(dayKey(first));
  const today = dayKey();
  const byDay = new Map();
  for (const meal of state.meals) {
    if (!byDay.has(meal.day)) byDay.set(meal.day, []);
    byDay.get(meal.day).push(meal);
  }
  const cells = [];
  for (let day = start; cells.length < 42; day = addDays(day, 1)) {
    if (cells.length % 7 === 0 && cells.length >= 28 && !day.startsWith(month)) break;
    const meals = (byDay.get(day) || []).sort((a, b) => a.at - b.at);
    const inMonth = day.startsWith(month);
    const future = day > today;
    cells.push(`<li class="cal-day${inMonth ? '' : ' other'}${day === today ? ' today' : ''}${future ? ' future' : ''}">
      ${future || meals.length ? `<span class="num">${keyDate(day).getDate()}</span>`
        : `<button class="num" data-action="add-meal" data-day="${day}" aria-label="What did you make on ${esc(shortDay(day))}?">${keyDate(day).getDate()}</button>`}
      ${meals.map((m) => `<button class="cal-dish" data-action="open-dish" data-key="${esc(dishKey(m.dish))}">${esc(m.dish)}</button>`).join('')}
    </li>`);
  }
  const title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('#calendar').innerHTML = `<div class="cal-head">
      <button class="btn quiet round" data-action="month" data-step="-1" aria-label="The month before">‹</button>
      <h2>${esc(title)}</h2>
      <button class="btn quiet round" data-action="month" data-step="1" aria-label="The month after" ${month >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <ol class="cal-names" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<li>${d}</li>`).join('')}</ol>
    <ol class="cal">${cells.join('')}</ol>
    <p class="hint-line">Tap a day to tell Selma what you made then.</p>`;
  renderLog();
}

function matches(meal) {
  const q = filter.q.trim().toLowerCase();
  if (!q) return true;
  const text = [meal.dish, meal.from, meal.note].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => text.includes(word));
}

function weekName(monday) {
  const ago = daysBetween(monday, mondayOf(dayKey())) / 7;
  if (ago === 0) return 'This week';
  if (ago === 1) return 'Last week';
  return `Week of ${longDate(monday)}`;
}

function mealHTML(meal) {
  const key = dishKey(meal.dish);
  return `<li><button class="meal" data-action="open-dish" data-key="${esc(key)}">
    <span class="day">${esc(shortDay(meal.day))}</span>
    <span class="what">
      <span class="name">${esc(meal.dish)}${isKeeper(key) ? ` <span class="keeper" title="A keeper">${HEART}</span>` : ''}</span>
      ${meal.from ? `<span class="from">${esc(fromLine(meal.from))}</span>` : ''}
      ${meal.note ? `<span class="note">${esc(meal.note)}</span>` : ''}
    </span>
  </button></li>`;
}

function renderLog() {
  const el = $('#log');
  if (!state.meals.length) {
    el.innerHTML = '<p class="quiet-line">Nothing made yet.</p>';
    return;
  }
  const meals = state.meals.filter(matches).sort(newestFirst);
  if (!meals.length) {
    el.innerHTML = '<p class="empty">Nothing in the kitchen matches that.</p>';
    return;
  }
  const weeks = new Map();
  for (const meal of meals) {
    const monday = mondayOf(meal.day);
    if (!weeks.has(monday)) weeks.set(monday, []);
    weeks.get(monday).push(meal);
  }
  el.innerHTML = [...weeks].map(([monday, list]) => `
    <section class="week">
      <h3>${esc(weekName(monday))}</h3>
      <ul class="meals">${list.map(mealHTML).join('')}</ul>
    </section>`).join('');
}

/* ---------- Recipes ---------- */

function cardHTML(dish) {
  const from = fromOf(dish);
  const n = daysSince(dish);
  return `<button class="card" data-action="open-dish" data-key="${esc(dish.key)}">
    <span class="name">${esc(dish.name)}</span>
    ${isKeeper(dish.key) ? `<span class="keeper" title="A keeper">${HEART}</span>` : ''}
    <span class="last${n !== null && n < RESTING_DAYS ? ' recent' : ''}">${esc(sinceText(dish))}</span>
    ${from ? `<span class="from">${esc(fromLine(from))}</span>` : ''}
    ${state.lineup.includes(dish.key) ? '<span class="planned">In the line-up</span>' : ''}
  </button>`;
}

function renderBox() {
  const all = [...dishes().values()];
  if (!all.some((d) => isKeeper(d.key))) filter.keepers = false;
  $('#box-filter').innerHTML = all.some((d) => isKeeper(d.key)) ? `
    <label><input type="radio" name="box-show" value="all" ${filter.keepers ? '' : 'checked'}><span>Every dish</span></label>
    <label><input type="radio" name="box-show" value="keepers" ${filter.keepers ? 'checked' : ''}><span>${HEART} Keepers</span></label>` : '';
  $('#box-sort').innerHTML = all.length > 1 ? `Arrange by
    <button data-action="sort" data-by="az" aria-pressed="${filter.sort === 'az'}">name</button>
    <button data-action="sort" data-by="since" aria-pressed="${filter.sort === 'since'}">longest ago</button>` : '';
  $('#pick-button').hidden = all.length < 2;
  renderPick();
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const list = all
    .filter((d) => !filter.keepers || isKeeper(d.key))
    .sort(filter.sort === 'since' ? (a, b) => (daysSince(b) ?? 1e6) - (daysSince(a) ?? 1e6) || byName(a, b) : byName);
  $('#box').innerHTML = list.length
    ? `<div class="cards">${list.map(cardHTML).join('')}</div>`
    : '<p class="empty">Nothing in the recipe box yet. Add your usual recipes, with their ingredients, and they line up here.</p>';
}

// Selma suggests a dish: a keeper if there are any, and not one made in the last week if that can be helped.
function pick() {
  const all = [...dishes().values()];
  const keepers = all.filter((d) => isKeeper(d.key));
  const pool = keepers.length >= 2 ? keepers : all;
  const rested = pool.filter((d) => (daysSince(d) ?? 1e6) >= RESTING_DAYS);
  const choices = (rested.length ? rested : pool).filter((d) => d.key !== picked);
  const from = choices.length ? choices : pool;
  picked = from[Math.floor(Math.random() * from.length)].key;
  renderPick();
}

function renderPick() {
  const dish = picked && dishes().get(picked);
  const note = dish && lastNote(dish);
  $('#pick').innerHTML = dish ? `<div class="nudge pick">
    <p>How about <button class="link big" data-action="open-dish" data-key="${esc(dish.key)}">${esc(dish.name)}</button>?
      ${esc(sinceText(dish))}.</p>
    ${note ? `<p class="said">Last time you said: “${esc(note.note)}”</p>` : ''}
    <p>${state.lineup.includes(dish.key) ? '' : `<button class="link" data-action="plan" data-key="${esc(dish.key)}">Put it in the line-up</button>`}
      <button class="link" data-action="pick">Another</button><button class="link" data-action="pick-done">Never mind</button></p>
  </div>` : '';
}

/* ---------- A dish card ---------- */

function renderDish() {
  const dish = dishes().get(openDish);
  if (!dish) return dishDialog.close();
  const from = [...new Set([dish.recipe?.from, ...dish.meals.map((m) => m.from)].filter(Boolean))];
  const planned = state.lineup.includes(dish.key);
  const lines = dish.recipe?.ingredients || [];
  $('#dish-card').innerHTML = `<article class="dish">
    <div class="head">
      <div>
        <h2>${esc(dish.name)}</h2>
        <p class="from">${esc(sinceText(dish))}${from.length ? ` · ${from.map((f) => (madeItUp(f) ? '' : 'from ') + fromHTML(f)).join('; ')}` : ''}</p>
      </div>
      <button class="heart" data-action="keeper" aria-pressed="${isKeeper(dish.key)}" aria-label="A keeper" title="${isKeeper(dish.key) ? 'A keeper' : 'Mark as a keeper'}">${HEART}</button>
    </div>
    <section>
      <h3>Ingredients</h3>
      ${lines.length ? `<ul class="ingredients">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
        : `<p class="quiet-line">None yet. <button class="link" data-action="edit-recipe" data-key="${esc(dish.key)}">Add the ingredients</button> and they'll go on the shopping list whenever this is in the line-up.</p>`}
    </section>
    ${dish.recipe?.method ? `<section><h3>How to make it</h3><p class="method">${esc(dish.recipe.method)}</p></section>` : ''}
    ${dish.meals.length ? `<section>
      <h3>Made</h3>
      <ul class="times">${dish.meals.map((m) => `<li>
        <p class="when">${esc(longDate(m.day))}<button class="btn danger" data-action="edit-meal" data-id="${m.id}">Edit</button></p>
        ${m.note ? `<p class="said">${esc(m.note)}</p>` : ''}
      </li>`).join('')}</ul>
    </section>` : ''}
    <div class="foot">
      <button class="btn primary" data-action="made-it" data-key="${esc(dish.key)}">${dish.meals.length ? 'I made it again' : 'I made it'}</button>
      <button class="btn" data-action="${planned ? 'unplan' : 'plan'}" data-key="${esc(dish.key)}">${planned ? 'Take out of the line-up' : 'Add to the line-up'}</button>
      <button class="btn quiet" data-action="edit-recipe" data-key="${esc(dish.key)}">Edit recipe</button>
      <span class="spacer"></span>
      <button class="btn quiet" data-action="close-dialog">Close</button>
    </div>
  </article>`;
}

function openDishCard(key) {
  openDish = key;
  renderDish();
  if (!dishDialog.open) dishDialog.showModal();
  dishDialog.scrollTop = 0;
}

dishDialog.addEventListener('close', () => { openDish = null; });
dishDialog.addEventListener('click', (event) => {
  if (event.target === dishDialog) dishDialog.close();
});

/* ---------- Telling Selma what you made ---------- */

function openMeal(meal, { dish = '', day = '' } = {}) {
  mealForm.reset();
  const isNew = !meal;
  $('#meal-heading').textContent = isNew ? (day && day !== dayKey() ? `What did you make on ${shortDay(day)}?` : 'What did you make?') : 'Change this';
  $('#meal-submit').textContent = isNew ? 'Keep it' : 'Save';
  $('#remove-meal').hidden = isNew;
  const all = [...dishes().values()];
  $('#dishes').innerHTML = all.map((d) => `<option value="${esc(d.name)}">`).join('');
  $('#sources').innerHTML = [...new Set(all.map(fromOf).filter(Boolean))].sort()
    .map((s) => `<option value="${esc(s)}">`).join('');
  mealForm.id.value = meal?.id || '';
  mealForm.dish.value = meal?.dish || dish;
  mealForm.day.value = meal?.day || day || dayKey();
  mealForm.from.value = meal?.from || '';
  mealForm.note.value = meal?.note || '';
  mealForm.keeper.checked = isKeeper(dishKey(mealForm.dish.value));
  recall();
  mealDialog.showModal();
  if (dish) mealForm.note.focus();
}

// Typing a dish made before brings back when that was and what you said last time.
function recall() {
  const dish = dishes().get(dishKey(mealForm.dish.value));
  const editing = mealForm.id.value;
  const earlier = dish?.meals.filter((m) => m.id !== editing) || [];
  const note = earlier.find((m) => m.note);
  const day = mealForm.day.value || dayKey();
  const ago = earlier.length ? daysBetween(earlier[0].day, day) : 0;
  const gap = ago > 1 ? `, ${ago} days ${day === dayKey() ? 'ago' : 'before that'}` : '';
  $('#last-time').innerHTML = earlier.length ? `<p class="last-time">
    Last made ${esc(longDate(earlier[0].day))}${gap}.${note ? ` You said: “${esc(note.note)}”` : ''}</p>` : '';
  if (!editing && dish) {
    if (!mealForm.from.value) mealForm.from.value = fromOf(dish);
    mealForm.keeper.checked = isKeeper(dish.key);
  }
}
mealForm.dish.addEventListener('input', recall);
mealForm.day.addEventListener('change', recall);

mealForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(mealForm);
  let dish = form.get('dish').trim().replace(/\s+/g, ' ');
  if (!dish) return;
  // "lentil soup" typed in a hurry keeps the name it already has.
  const known = dishes().get(dishKey(dish));
  if (known && dish === dish.toLowerCase()) dish = known.name;
  const key = dishKey(dish);
  const details = { dish, day: form.get('day') || dayKey(), from: form.get('from').trim(), note: form.get('note').trim() };
  const id = form.get('id');
  let message = 'Saved.';
  if (id) {
    Object.assign(state.meals.find((m) => m.id === id), details);
  } else {
    state.meals.push({ id: newId(), ...details, at: Date.now() });
    message = 'Kept. Sounds good.';
    // Making a dish from the line-up takes it off, along with its shopping.
    if (state.lineup.includes(key)) {
      state.lineup = state.lineup.filter((k) => k !== key);
      message = 'Kept, and taken off the line-up.';
    }
  }
  setKeeper(key, form.get('keeper') === 'on');
  tidy();
  save();
  mealDialog.close();
  toast(message);
  if (dishDialog.open) {
    if (dishes().has(openDish)) renderDish();
    else openDishCard(key);
  }
  RENDER[view]();
});

/* ---------- Recipes: adding and editing ---------- */

function openRecipe(key = '') {
  recipeForm.reset();
  const dish = key ? dishes().get(key) : null;
  $('#recipe-heading').textContent = dish ? 'Edit recipe' : 'Add a recipe';
  $('#recipe-submit').textContent = dish ? 'Save' : 'Keep it';
  // A recipe can go only while nothing made from it is in the journal.
  $('#remove-recipe').hidden = !dish?.recipe || dish.meals.length > 0;
  recipeForm.key.value = key;
  recipeForm.name.value = dish?.name || '';
  recipeForm.from.value = dish ? fromOf(dish) : '';
  recipeForm.ingredients.value = (dish?.recipe?.ingredients || []).join('\n');
  recipeForm.method.value = dish?.recipe?.method || '';
  recipeForm.keeper.checked = key ? isKeeper(key) : false;
  recipeDialog.showModal();
  if (dish) recipeForm.ingredients.focus();
}

recipeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(recipeForm);
  const name = form.get('name').trim().replace(/\s+/g, ' ');
  if (!name) return;
  const oldKey = form.get('key');
  const key = dishKey(name);
  if (key !== oldKey && dishes().get(key)?.recipe) return toast(`There is already a ${name} in the recipe box.`);
  if (oldKey) rename(oldKey, name);
  state.recipes[key] = {
    name,
    from: form.get('from').trim(),
    // One per line; a leading dash or bullet is left off.
    ingredients: form.get('ingredients').split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean),
    method: form.get('method').trim(),
  };
  setKeeper(key, form.get('keeper') === 'on');
  tidy();
  save();
  recipeDialog.close();
  toast(oldKey ? 'Saved.' : 'In the recipe box.');
  if (dishDialog.open) openDishCard(key);
  RENDER[view]();
});

/* ---------- Views ---------- */

const RENDER = { week: renderWeek, shop: renderShop, calendar: renderCalendar, box: renderBox };

function show(next) {
  view = next;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === next) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const name of Object.keys(RENDER)) $(`#view-${name}`).hidden = name !== next;
  RENDER[next]();
  try { sessionStorage.setItem('selma-cook.view', next); } catch {}
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Clicks ---------- */

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab, [data-view-go]');
  if (tab) {
    window.scrollTo(0, 0);
    return show(tab.dataset.view || tab.dataset.viewGo);
  }
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const key = el.dataset.key;

  if (action === 'add-meal') openMeal(null, { day: el.dataset.day });
  else if (action === 'made-it') openMeal(null, { dish: dishes().get(key).name });
  else if (action === 'open-dish') openDishCard(key);
  else if (action === 'close-dialog') el.closest('dialog').close();
  else if (action === 'edit-meal') openMeal(state.meals.find((m) => m.id === el.dataset.id));
  else if (action === 'add-recipe') openRecipe();
  else if (action === 'edit-recipe') openRecipe(key);
  else if (action === 'keeper') {
    setKeeper(openDish, !isKeeper(openDish));
    save();
    renderDish();
    RENDER[view]();
  }
  else if (action === 'plan' || action === 'unplan') {
    state.lineup = state.lineup.filter((k) => k !== key);
    if (action === 'plan') state.lineup.push(key);
    if (picked === key) picked = null;
    tidy();
    save();
    if (dishDialog.open) renderDish();
    RENDER[view]();
    toast(action === 'plan' ? 'In the line-up.' : 'Out of the line-up.');
  }
  else if (action === 'remove-meal') {
    if (!confirm('Remove this from the journal?')) return;
    state.meals = state.meals.filter((m) => m.id !== mealForm.id.value);
    tidy();
    save();
    mealDialog.close();
    if (dishDialog.open) renderDish();
    RENDER[view]();
    toast('Removed.');
  }
  else if (action === 'remove-recipe') {
    const target = recipeForm.key.value;
    if (!confirm(`Take ${state.recipes[target].name} out of the recipe box?`)) return;
    delete state.recipes[target];
    tidy();
    save();
    recipeDialog.close();
    if (dishDialog.open) dishDialog.close();
    RENDER[view]();
    toast('Taken out of the recipe box.');
  }
  else if (action === 'month') {
    const date = keyDate(month + '-01');
    date.setMonth(date.getMonth() + Number(el.dataset.step));
    month = dayKey(date).slice(0, 7);
    renderCalendar();
  }
  else if (action === 'sort') { filter.sort = el.dataset.by; renderBox(); }
  else if (action === 'pick') pick();
  else if (action === 'pick-done') { picked = null; renderPick(); }
  else if (action === 'remove-extra') {
    state.shopping.extras = state.shopping.extras.filter((x) => x.id !== el.dataset.id);
    save();
    renderShop();
  }
  else if (action === 'untick') {
    state.shopping.got = [];
    for (const x of state.shopping.extras) x.got = false;
    save();
    renderShop();
  }
  else if (action === 'clear-extras') {
    state.shopping.extras = state.shopping.extras.filter((x) => !x.got);
    save();
    renderShop();
  }
  else if (action === 'copy-list') {
    const text = listText();
    if (!text) return toast('Everything is ticked off.');
    navigator.clipboard?.writeText(text).then(() => toast('Copied. Paste it wherever you like.'), () => toast('This browser would not copy that.'));
  }
  else if (action === 'export') exportBackup();
  else if (action === 'import') $('#import-file').click();
  else if (action === 'backup-later') {
    const later = new Date();
    later.setDate(later.getDate() + 3);
    localStorage.setItem(BACKUP_KEY + '-later', dayKey(later));
    renderWeek();
  }
});

document.addEventListener('change', (event) => {
  const t = event.target;
  if (t.name === 'box-show') {
    filter.keepers = t.value === 'keepers';
    renderBox();
  }
  // Ticking something off the shopping list.
  if (t.dataset.item) {
    state.shopping.got = state.shopping.got.filter((i) => i !== t.dataset.item);
    if (t.checked) state.shopping.got.push(t.dataset.item);
    save();
    renderShop();
  }
  if (t.dataset.extra) {
    state.shopping.extras.find((x) => x.id === t.dataset.extra).got = t.checked;
    save();
    renderShop();
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'extra-form') return;
  event.preventDefault();
  const text = event.target.text.value.trim();
  if (!text) return;
  state.shopping.extras.push({ id: newId(), text, got: false });
  save();
  renderShop();
  $('#extra-form input').focus();
});

$('#search').addEventListener('input', (event) => {
  filter.q = event.target.value;
  renderLog();
});

/* ---------- Backup ---------- */

function renderBackup() {
  const last = localStorage.getItem(BACKUP_KEY);
  $('#backup-status').textContent = last ? `Last backup saved ${longDate(last)}.` : 'No backup saved yet.';
}

function exportBackup() {
  const file = new Blob([JSON.stringify({ app: 'selma-cook', version: 1, data: state }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `selma-cook-backup-${dayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  localStorage.setItem(BACKUP_KEY, dayKey());
  renderBackup();
  RENDER[view]();
}

// A gentle reminder on This week: a week after the first entry if there has never been a backup,
// or two weeks after the last one. "Later" puts it off for three days.
function backupDue() {
  if (!state.meals.length) return false;
  const later = localStorage.getItem(BACKUP_KEY + '-later');
  if (later && later > dayKey()) return false;
  const last = localStorage.getItem(BACKUP_KEY);
  const first = dayKey(new Date(Math.min(...state.meals.map((m) => m.at))));
  return last ? daysBetween(last, dayKey()) >= 14 : daysBetween(first, dayKey()) >= 7;
}

// Restoring replaces everything on this device with what the backup holds.
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = parsed.app === 'selma-cook' ? parsed.data : parsed;
    if (!Array.isArray(data.meals)) throw new Error();
  } catch {
    return toast('That file is not a Selma kitchen journal backup.');
  }
  const recipes = Object.keys(data.recipes || {}).length;
  if (!confirm(`Replace everything on this device with this backup? It holds ${recipes} recipes and ${data.meals.length} meals. What is here now will be gone.`)) return;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, blankState(), data);
  save();
  show(view);
  toast('Restored.');
});

renderBackup();
// Opens where you left off within a visit (e.g., the shopping list, after checking another app).
let start = 'week';
try { start = sessionStorage.getItem('selma-cook.view') || 'week'; } catch {}
show(RENDER[start] ? start : 'week');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
