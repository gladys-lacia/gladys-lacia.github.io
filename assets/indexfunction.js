// Gives each services item the same width as the WhatsApp block (whose width follows its unwrapped caption).
(function () {
  var whatsapp = document.querySelector('.whatsapp');
  if (!whatsapp) return;

  new ResizeObserver(function () {
    document.documentElement.style.setProperty('--side-w', whatsapp.offsetWidth + 'px');
  }).observe(whatsapp);
})();
