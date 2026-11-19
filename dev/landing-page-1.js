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
