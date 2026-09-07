// A small, themed autocomplete dropdown -- built to replace native
// <input list>/<datalist> combos, which only show suggestions once
// you've started typing and render using OS chrome that doesn't match
// this app's own light/dark themes. Not hardcoded to tags despite the
// name/original use case (personDetail.js's tag input) -- generic
// enough that a future picker (e.g. a content library's own tags/
// categories) can reuse it.

import { escapeHtml } from './helpers.js';

const MAX_SUGGESTIONS = 8;

// attachTagAutocomplete({ input, getOptions, onSelect })
// - getOptions(): () => string[] -- called fresh on every keystroke/focus,
//   so the caller's own data (e.g. an already-loaded tag list) stays the
//   single source of truth; this module never fetches or caches it.
// - onSelect(label): called when a suggestion is picked (click, or
//   Enter with one highlighted) -- the *only* way data leaves this
//   module. Plain Enter with nothing highlighted is left to the
//   input's own form submit (so a brand-new label can still be added),
//   not swallowed here.
export function attachTagAutocomplete({ input, getOptions, onSelect }) {
  const list = document.createElement('ul');
  list.className = 'autocomplete-list';
  list.hidden = true;

  // Positioned relative to a wrapper rather than the input directly, so
  // this works regardless of the input's own layout context (inline-form,
  // etc.) -- CSS just needs one positioned ancestor.
  const wrapper = document.createElement('div');
  wrapper.className = 'autocomplete-wrapper';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  wrapper.appendChild(list);

  let matches = [];
  let activeIndex = -1;

  function render() {
    const query = input.value.trim().toLowerCase();
    const options = getOptions();
    matches = (query ? options.filter((label) => label.toLowerCase().includes(query)) : options).slice(0, MAX_SUGGESTIONS);

    if (matches.length === 0) {
      close();
      return;
    }

    activeIndex = -1;
    list.innerHTML = matches.map((label) => `<li class="autocomplete-item">${escapeHtml(label)}</li>`).join('');
    list.hidden = false;
  }

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    matches = [];
    activeIndex = -1;
  }

  function setActive(index) {
    activeIndex = index;
    Array.from(list.children).forEach((li, i) => li.classList.toggle('active', i === activeIndex));
  }

  function pick(label) {
    close();
    onSelect(label);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', render);

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeIndex + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      // Only intercept Enter when a suggestion is actually highlighted --
      // otherwise let it fall through to the surrounding <form>'s submit,
      // so typing a brand-new label + Enter still works.
      event.preventDefault();
      pick(matches[activeIndex]);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  list.addEventListener('mousedown', (event) => {
    // mousedown (not click) fires before the input's blur, so close()
    // below doesn't race with the input losing focus and hide the list
    // out from under the click.
    const li = event.target.closest('.autocomplete-item');
    if (!li) return;
    event.preventDefault();
    pick(matches[Array.from(list.children).indexOf(li)]);
  });

  input.addEventListener('blur', () => {
    // Deferred so a mousedown on the list (above) still lands first.
    setTimeout(close, 100);
  });
}
