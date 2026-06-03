/* ============================================================
   AlexCloud — main.js
   All site interactivity (vanilla JS, no modules)
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     Cache DOM references once
  ---------------------------------------------------------- */
  var scrollProgressBar = null;
  var navbar            = null;
  var navLinks          = null;
  var hamburger         = null;
  var aiChatWindow      = null;
  var aiChatToggleBtn   = null;
  var searchInput       = null;
  var searchDropdown    = null;
  var backToTopBtn      = null;
  var copyrightEl       = null;

  /* ----------------------------------------------------------
     Game catalogue (used by search)
  ---------------------------------------------------------- */
  var gameCatalogue = [
    'EA FC 26', 'EA FC 25', 'EA FC 24',
    'MotoGP 25', 'MotoGP 24',
    'Alan Wake 2', 'Hogwarts Legacy',
    'God of War Ragnarök', 'Spider-Man 2',
    'Elden Ring', 'Cyberpunk 2077',
    'Red Dead Redemption 2', 'GTA V',
    'Forza Horizon 5', 'Call of Duty MW3',
    'Resident Evil 4 Remake', 'The Last of Us Part I',
    'Assassin\'s Creed Mirage', 'Starfield',
    'Tekken 8', 'Mortal Kombat 1',
    'NBA 2K25', 'WWE 2K24',
    'Need for Speed Unbound', 'Gran Turismo 7'
  ];

  /* ==========================================================
     1. Scroll Progress Bar
  ========================================================== */
  function updateScrollProgress() {
    if (!scrollProgressBar) return;
    var scrollTop   = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight   = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    var scrollPct   = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    scrollProgressBar.style.width = scrollPct + '%';
  }

  /* ==========================================================
     2. Navbar Sticky Effect
  ========================================================== */
  function handleStickyNavbar() {
    if (!navbar) return;
    if (window.pageYOffset > 50) {
      navbar.classList.add('sticky');
      navbar.style.boxShadow = '0 2px 12px rgba(0,0,0,.15)';
    } else {
      navbar.classList.remove('sticky');
      navbar.style.boxShadow = '';
    }
  }

  /* ==========================================================
     3. Mobile Nav Toggle
  ========================================================== */
  function toggleNav() {
    if (!navLinks) return;

    var isOpen = navLinks.classList.toggle('active');

    if (hamburger) {
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
    }

    // Prevent body scroll when menu is open
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
  // Expose globally
  window.toggleNav = toggleNav;

  /* ==========================================================
     4. Smooth Scroll for Anchor Links
  ========================================================== */
  function initSmoothScroll() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;

      var targetId = link.getAttribute('href');
      if (targetId === '#' || targetId.length < 2) return;

      var target = document.querySelector(targetId);
      if (!target) return;

      e.preventDefault();

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Close mobile nav if open
      if (navLinks && navLinks.classList.contains('active')) {
        toggleNav();
      }
    });
  }

  /* ==========================================================
     5. FAQ Accordion
  ========================================================== */
  function initFAQAccordion() {
    var questions = document.querySelectorAll('.faq-question');
    if (!questions.length) return;

    questions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item   = btn.closest('.faq-item');
        var answer = item ? item.querySelector('.faq-answer') : null;
        if (!item || !answer) return;

        var isActive = item.classList.contains('active');

        // Optional: close other items (uncomment for single-open mode)
        // document.querySelectorAll('.faq-item.active').forEach(function (other) {
        //   if (other !== item) {
        //     other.classList.remove('active');
        //     var otherAnswer = other.querySelector('.faq-answer');
        //     if (otherAnswer) { otherAnswer.style.maxHeight = null; }
        //   }
        // });

        if (isActive) {
          item.classList.remove('active');
          answer.style.maxHeight = null;
          answer.style.paddingTop = '';
          answer.style.paddingBottom = '';
        } else {
          item.classList.add('active');
          answer.style.maxHeight = answer.scrollHeight + 'px';
          answer.style.paddingTop = '12px';
          answer.style.paddingBottom = '16px';
        }
      });
    });
  }

  /* ==========================================================
     6. Testimonial Slider
  ========================================================== */
  function initTestimonialSlider() {
    var cards = document.querySelectorAll('.testimonial-card');
    if (!cards.length) return;

    var currentIndex  = 0;
    var totalCards     = cards.length;
    var autoPlayTimer  = null;
    var sliderPrev     = document.querySelector('.testimonial-prev, .slider-prev');
    var sliderNext     = document.querySelector('.testimonial-next, .slider-next');
    var dotsContainer  = document.querySelector('.testimonial-dots, .slider-dots');

    function showSlide(index) {
      if (index < 0) index = totalCards - 1;
      if (index >= totalCards) index = 0;
      currentIndex = index;

      cards.forEach(function (card, i) {
        card.classList.toggle('active', i === currentIndex);
        card.style.display = i === currentIndex ? '' : 'none';
      });

      // Update dots if present
      if (dotsContainer) {
        var dots = dotsContainer.querySelectorAll('.dot, .slider-dot');
        dots.forEach(function (dot, i) {
          dot.classList.toggle('active', i === currentIndex);
        });
      }
    }

    function nextSlide() { showSlide(currentIndex + 1); }
    function prevSlide() { showSlide(currentIndex - 1); }

    function startAutoPlay() {
      stopAutoPlay();
      autoPlayTimer = setInterval(nextSlide, 5000);
    }

    function stopAutoPlay() {
      if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
    }

    if (sliderPrev) {
      sliderPrev.addEventListener('click', function () { stopAutoPlay(); prevSlide(); startAutoPlay(); });
    }
    if (sliderNext) {
      sliderNext.addEventListener('click', function () { stopAutoPlay(); nextSlide(); startAutoPlay(); });
    }

    // Build dots dynamically if container exists but is empty
    if (dotsContainer && !dotsContainer.children.length) {
      for (var i = 0; i < totalCards; i++) {
        var dot = document.createElement('span');
        dot.className = 'dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('data-slide', i);
        dot.addEventListener('click', (function (idx) {
          return function () { stopAutoPlay(); showSlide(idx); startAutoPlay(); };
        })(i));
        dotsContainer.appendChild(dot);
      }
    }

    showSlide(0);
    startAutoPlay();

    // Expose controls globally
    window.nextTestimonial = function () { stopAutoPlay(); nextSlide(); startAutoPlay(); };
    window.prevTestimonial = function () { stopAutoPlay(); prevSlide(); startAutoPlay(); };
  }

  /* ==========================================================
     7. Intersection Observer — Scroll Animations
  ========================================================== */
  function initScrollAnimations() {
    var animatedEls = document.querySelectorAll('[data-animate]');
    if (!animatedEls.length) return;

    if (!('IntersectionObserver' in window)) {
      // Fallback: just show everything
      animatedEls.forEach(function (el) { el.classList.add('animated'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('animated');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    animatedEls.forEach(function (el) { observer.observe(el); });
  }

  /* ==========================================================
     8. AI Chat Toggle
  ========================================================== */
  function toggleAIChat() {
    if (!aiChatWindow) return;

    var isOpen = aiChatWindow.classList.toggle('open');

    if (aiChatToggleBtn) {
      aiChatToggleBtn.setAttribute('aria-expanded', String(isOpen));
    }

    // Focus input when opening
    if (isOpen) {
      var input = aiChatWindow.querySelector('#aiChatInput');
      if (input) input.focus();
    }
  }
  window.toggleAIChat = toggleAIChat;

  /* ==========================================================
     9. Dynamic Copyright Year
  ========================================================== */
  function setCopyrightYear() {
    copyrightEl = document.querySelector('#copyrightYear, .copyright-year');
    if (copyrightEl) {
      copyrightEl.textContent = new Date().getFullYear();
    }
  }

  /* ==========================================================
     10. Search Functionality
  ========================================================== */
  function initSearch() {
    searchInput    = document.getElementById('navSearchInput');
    searchDropdown = document.getElementById('searchDropdown');
    if (!searchInput || !searchDropdown) return;

    searchInput.addEventListener('input', function () {
      var query = searchInput.value.trim().toLowerCase();

      if (query.length < 2) {
        searchDropdown.classList.remove('visible');
        searchDropdown.innerHTML = '';
        return;
      }

      var results = gameCatalogue.filter(function (name) {
        return name.toLowerCase().indexOf(query) !== -1;
      });

      if (!results.length) {
        searchDropdown.innerHTML = '<div class="search-item no-results">Tidak ada hasil untuk "<strong>' + escapeHtml(query) + '</strong>"</div>';
      } else {
        searchDropdown.innerHTML = results.map(function (name) {
          return '<div class="search-item" data-game="' + escapeHtml(name) + '">' +
                 highlightMatch(name, query) +
                 '</div>';
        }).join('');
      }

      searchDropdown.classList.add('visible');
    });

    // Handle clicks on search results
    searchDropdown.addEventListener('click', function (e) {
      var item = e.target.closest('.search-item[data-game]');
      if (!item) return;
      var gameName = item.getAttribute('data-game');
      searchInput.value = gameName;
      searchDropdown.classList.remove('visible');
      // Scroll to games section if it exists
      var gamesSection = document.getElementById('games') || document.getElementById('game-list');
      if (gamesSection) {
        gamesSection.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#navSearchInput') && !e.target.closest('#searchDropdown')) {
        if (searchDropdown) searchDropdown.classList.remove('visible');
      }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchDropdown.classList.remove('visible');
        searchInput.blur();
      }
    });
  }

  function highlightMatch(text, query) {
    var idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.substring(0, idx)) +
           '<mark>' + escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' +
           escapeHtml(text.substring(idx + query.length));
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ==========================================================
     11. Lazy Image Loading
  ========================================================== */
  function initLazyLoading() {
    var lazyImages = document.querySelectorAll('img[data-src], img[loading="lazy"]');
    if (!lazyImages.length) return;

    if (!('IntersectionObserver' in window)) {
      // Fallback: load all immediately
      lazyImages.forEach(function (img) {
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
      });
      return;
    }

    var imgObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          img.classList.add('loaded');
          imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '100px 0px' });

    lazyImages.forEach(function (img) { imgObserver.observe(img); });
  }

  /* ==========================================================
     12. Back to Top Button
  ========================================================== */
  function initBackToTop() {
    // Create button if it doesn't already exist in the DOM
    backToTopBtn = document.getElementById('backToTop');
    if (!backToTopBtn) {
      backToTopBtn = document.createElement('button');
      backToTopBtn.id = 'backToTop';
      backToTopBtn.className = 'back-to-top';
      backToTopBtn.setAttribute('aria-label', 'Kembali ke atas');
      backToTopBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
      document.body.appendChild(backToTopBtn);
    }

    backToTopBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function handleBackToTopVisibility() {
    if (!backToTopBtn) return;
    if (window.pageYOffset > 400) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
  }

  /* ==========================================================
     Scroll Handler (throttled)
  ========================================================== */
  var scrollTicking = false;

  function onScroll() {
    if (!scrollTicking) {
      window.requestAnimationFrame(function () {
        updateScrollProgress();
        handleStickyNavbar();
        handleBackToTopVisibility();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }

  /* ==========================================================
     Init
  ========================================================== */
  function init() {
    // Cache elements
    scrollProgressBar = document.querySelector('.scroll-progress');
    navbar            = document.querySelector('.navbar, nav');
    navLinks          = document.querySelector('.nav-links');
    hamburger         = document.querySelector('.hamburger, .nav-toggle, .menu-toggle');
    aiChatWindow      = document.getElementById('aiChatWindow');
    aiChatToggleBtn   = document.querySelector('[data-chat-toggle], .ai-chat-toggle, #aiChatToggle');

    // Wire up hamburger click
    if (hamburger) {
      hamburger.addEventListener('click', toggleNav);
    }

    // Initialise all features
    setCopyrightYear();
    initSmoothScroll();
    initFAQAccordion();
    initTestimonialSlider();
    initScrollAnimations();
    initSearch();
    initLazyLoading();
    initBackToTop();

    // Scroll listener
    window.addEventListener('scroll', onScroll, { passive: true });

    // Run once on load in case the page is already scrolled
    onScroll();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
