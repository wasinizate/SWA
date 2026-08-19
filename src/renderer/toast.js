// Small non-blocking toast notification -- replaces blocking alert() for
// routine success/info messages (e.g. "Saved to: <path>"). A manual
// dismiss (x) is included, not just a fixed auto-hide, since some
// messages contain a file path worth actually reading rather than
// glancing at before it disappears. See main.css's .toast-container/
// .toast rules for the visual treatment.
//
// Error messages and confirm() dialogs are deliberately NOT routed
// through this -- those still need to block until acknowledged.

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, { duration = 4000 } = {}) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '×';
  toast.appendChild(closeBtn);

  let hideTimeout = null;
  function remove() {
    clearTimeout(hideTimeout);
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200); // matches the CSS transition duration
  }
  closeBtn.addEventListener('click', remove);

  getContainer().appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  hideTimeout = setTimeout(remove, duration);
}
