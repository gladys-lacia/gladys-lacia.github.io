// Sizes the left picture column to the visible (right) half of the image.
(function () {
  var img = document.querySelector('.portrait img');
  if (!img) return;

  function setPortraitWidth() {
    // The image is clipped to its right half, so the visible width is half its rendered width.
    var visible = img.offsetWidth / 2;
    if (visible > 0) {
      document.body.style.setProperty('--portrait-w', visible + 'px');
    }
  }

  if (img.complete) { setPortraitWidth(); }
  img.addEventListener('load', setPortraitWidth);
  window.addEventListener('resize', setPortraitWidth);
})();

// VA Niches popup: opens over <main class="center">, same position and height.
// (Width is handled in CSS: width: max-content.)
(function () {
  var popup = document.getElementById('nichesPopup');
  var center = document.querySelector('.center');
  var trigger = document.querySelector('.btn-niches');
  var closeBtn = popup && popup.querySelector('.niches-popup-close');
  if (!popup || !center || !trigger) return;

  function place() {
    var r = center.getBoundingClientRect();
    popup.style.left = r.left + 'px';
    popup.style.top = r.top + 'px';
    popup.style.height = r.height + 'px';
  }
  function open() {
    popup.hidden = false;
    place();
    closeBtn.focus();
  }
  function close() {
    popup.hidden = true;
    trigger.focus();
  }

  trigger.addEventListener('click', function (e) {
    e.preventDefault();
    open();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !popup.hidden) close();
  });
  window.addEventListener('resize', function () {
    if (!popup.hidden) place();
  });
})();
