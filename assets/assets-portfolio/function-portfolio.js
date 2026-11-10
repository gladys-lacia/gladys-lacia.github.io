/* Viewer for portfolio/index.html
   - Adds a small "view" icon button to every screenshot in .screenshots (image pop-up).
   - Powers the "view" icon button next to the diploma (PDF pop-up).
   - The pop-up closes ONLY through the small "close" icon button in its top-right corner.
     Clicking the backdrop, the content, or pressing Escape does not close it. */

(function () {
  'use strict';

  var VIEW_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>';

  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<line x1="18" y1="6" x2="6" y2="18"></line>' +
    '<line x1="6" y1="6" x2="18" y2="18"></line>' +
    '</svg>';

  var main = document.querySelector('main');
  var lightbox = null;
  var lightboxDialog = null;
  var lightboxImage = null;
  var lightboxFrame = null;
  var closeButton = null;
  var lastTrigger = null;

  /* ---------- Pop-up ---------- */

  function buildLightbox() {
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.hidden = true;

    lightboxDialog = document.createElement('div');
    lightboxDialog.className = 'lightbox-dialog';
    lightboxDialog.setAttribute('role', 'dialog');
    lightboxDialog.setAttribute('aria-modal', 'true');

    lightboxImage = document.createElement('img');
    lightboxImage.className = 'lightbox-image';
    lightboxImage.alt = '';
    lightboxImage.hidden = true;

    lightboxFrame = document.createElement('iframe');
    lightboxFrame.className = 'lightbox-frame';
    lightboxFrame.setAttribute('tabindex', '-1');
    lightboxFrame.hidden = true;

    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'lightbox-close';
    closeButton.setAttribute('aria-label', 'Close pop-up');
    closeButton.title = 'Close';
    closeButton.innerHTML = CLOSE_ICON;
    closeButton.addEventListener('click', closeLightbox);

    lightboxDialog.appendChild(lightboxImage);
    lightboxDialog.appendChild(lightboxFrame);
    lightboxDialog.appendChild(closeButton);
    lightbox.appendChild(lightboxDialog);
    document.body.appendChild(lightbox);

    /* Keep keyboard focus on the close button, its only focusable element.
       Escape is intentionally NOT handled: only the close button closes it. */
    lightbox.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        closeButton.focus();
      }
    });
  }

  function openLightbox(content, trigger) {
    if (!lightbox) {
      buildLightbox();
    }
    lastTrigger = trigger;

    if (content.type === 'embed') {
      lightboxDialog.classList.add('is-embed');
      lightboxDialog.setAttribute('aria-label', content.label);
      lightboxFrame.title = content.label;
      lightboxFrame.src = content.src;
      lightboxFrame.hidden = false;
      lightboxImage.hidden = true;
    } else {
      lightboxDialog.classList.remove('is-embed');
      lightboxDialog.setAttribute('aria-label', 'Screenshot viewer');
      lightboxImage.src = content.src;
      lightboxImage.alt = content.label;
      lightboxImage.hidden = false;
      lightboxFrame.hidden = true;
    }

    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    if (main) {
      main.setAttribute('inert', '');
    }
    closeButton.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImage.removeAttribute('src');
    lightboxFrame.removeAttribute('src');
    document.body.classList.remove('lightbox-open');
    if (main) {
      main.removeAttribute('inert');
    }
    if (lastTrigger) {
      lastTrigger.focus();
    }
  }

  /* ---------- "View" buttons on screenshots ---------- */

  function attachViewButton(image) {
    var wrapper = document.createElement('div');
    wrapper.className = 'screenshot-item';
    image.parentNode.insertBefore(wrapper, image);
    wrapper.appendChild(image);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-button';
    button.setAttribute('aria-label', 'View screenshot: ' + image.alt);
    button.title = 'View';
    button.innerHTML = VIEW_ICON;
    button.addEventListener('click', function () {
      openLightbox(
        { type: 'image', src: image.currentSrc || image.src, label: image.alt },
        button
      );
    });
    wrapper.appendChild(button);
  }

  var screenshots = document.querySelectorAll('.screenshots img');
  for (var i = 0; i < screenshots.length; i++) {
    attachViewButton(screenshots[i]);
  }

  /* ---------- "View" buttons for embedded documents (e.g., the diploma PDF) ---------- */

  function attachEmbedButton(button) {
    button.innerHTML = VIEW_ICON;
    button.addEventListener('click', function () {
      openLightbox(
        {
          type: 'embed',
          src: button.getAttribute('data-embed-src'),
          label: button.getAttribute('data-embed-label') || 'Document viewer'
        },
        button
      );
    });
  }

  var embedButtons = document.querySelectorAll('.view-button[data-embed-src]');
  for (var j = 0; j < embedButtons.length; j++) {
    attachEmbedButton(embedButtons[j]);
  }

  /* ---------- Section menu (hamburger) on small screens ---------- */

  var navToggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');

  if (navToggle && navLinks) {
    function setMenu(open) {
      navLinks.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    navToggle.addEventListener('click', function () {
      setMenu(!navLinks.classList.contains('is-open'));
    });

    /* Close the dropdown after a section link is chosen. */
    navLinks.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        setMenu(false);
      }
    });

    /* Close the dropdown when the visitor taps elsewhere on the page. */
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.section-nav')) {
        setMenu(false);
      }
    });
  }
})();
