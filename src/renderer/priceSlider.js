// A small paired range+number input for setting a money value quickly
// by dragging, while still allowing an exact figure typed in -- used
// anywhere a price is "the kind of number you'd want to nudge with a
// slider but still must be able to type precisely" (a content item's
// own suggested price, a per-file price, an order's price-paid
// override). Not a form element on its own -- renderPriceSliderHtml()
// returns markup to embed inside a larger form, wirePriceSlider() wires
// up the pair after that markup is in the DOM.

// The slider's own top end. It's just the *range's* ceiling, not a cap
// on the real value -- typing a bigger number than this into the number
// field is always allowed (wirePriceSlider leaves the range pinned at
// its max in that case, the number field still shows the true value).
// Doubling the current value (with a sane floor) means a slider starts
// out usable for adjusting a price down *or* up without immediately
// pinning at either end.
export function sliderMaxCentsFor(valueCents, floorCents = 20000) {
  return Math.max(valueCents * 2, floorCents);
}

export function priceSliderHtml({ idPrefix, valueCents = 0, sliderMaxCents, sliderStepCents = 100 }) {
  const max = sliderMaxCents ?? sliderMaxCentsFor(valueCents);
  return `
    <div class="price-slider">
      <input type="range" id="${idPrefix}-range" min="0" max="${max}" step="${sliderStepCents}"
             value="${Math.min(valueCents, max)}" aria-label="Price (drag to adjust)" />
      <input type="number" id="${idPrefix}-number" min="0" step="0.01" value="${(valueCents / 100).toFixed(2)}"
             aria-label="Price (dollars)" />
    </div>
  `;
}

// Keeps the range and number inputs in sync with each other and reports
// the current value (in cents) via onChange. The range fires onChange
// on 'change' (once, on release/arrow-key commit) rather than 'input'
// (which would fire continuously while dragging) -- matches how a
// slider is normally used to settle on a value. The number field fires
// on 'change' too (blur/Enter), so typing a full number doesn't trigger
// a save after every keystroke; both still update the *other* input
// live via 'input' so the pair always stays visually in sync.
export function wirePriceSlider(container, idPrefix, onChange) {
  const rangeEl = container.querySelector(`#${idPrefix}-range`);
  const numberEl = container.querySelector(`#${idPrefix}-number`);

  function currentCents() {
    return Math.round((Number.parseFloat(numberEl.value) || 0) * 100);
  }

  rangeEl.addEventListener('input', () => {
    numberEl.value = (Number(rangeEl.value) / 100).toFixed(2);
  });
  rangeEl.addEventListener('change', () => onChange(currentCents()));

  numberEl.addEventListener('input', () => {
    const cents = currentCents();
    if (cents <= Number(rangeEl.max)) rangeEl.value = cents;
  });
  numberEl.addEventListener('change', () => onChange(currentCents()));

  return { getCents: currentCents };
}
