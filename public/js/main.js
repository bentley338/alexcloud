// WARNING: JANGAN EDIT FILE INI SECARA LANGSUNG. Edit file .src.js yang sesuai. File ini di-minify otomatis saat startup server.
(function () {
  'use strict';
  var scrollProgressBar;
  var navbar;
  var navLinks;
  var hamburger;
  var backToTopBtn;
  function updateScrollProgress() {
    scrollProgressBar = document.getElementById('scrollProgress');
    if (!scrollProgressBar) return;
    var winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    var height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    var scrolled = height > 0 ? (winScroll / height) * 100 : 0;
    scrollProgressBar.style.width = scrolled + '%';
  }
  function handleStickyNavbar() {
    if (!navbar) return;
    if (window.scrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }
  function toggleNav() {
    navLinks = document.getElementById('navLinks');
    hamburger = document.getElementById('navToggleBtn') || document.querySelector('.hamburger, .nav-toggle');
    if (!navLinks) return;
    var isOpen = navLinks.classList.toggle('open');
    if (hamburger) {
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
      hamburger.setAttribute('aria-label', isOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi');
    }
  }
  window.toggleNav = toggleNav;
  function toggleUserMenu() {
    var dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.toggle('show');
  }
  window.toggleUserMenu = toggleUserMenu;
  document.addEventListener('click', function (e) {
    navLinks = document.getElementById('navLinks');
    hamburger = document.getElementById('navToggleBtn') || document.querySelector('.hamburger, .nav-toggle');
    var dropdown = document.getElementById('userDropdown');
    var userBtn = document.querySelector('.nav-user-btn');
    if (navLinks && navLinks.classList.contains('open')) {
      if (!navLinks.contains(e.target) && e.target !== hamburger && !hamburger.contains(e.target)) {
        navLinks.classList.remove('open');
        if (hamburger) {
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          hamburger.setAttribute('aria-label', 'Buka menu navigasi');
        }
      }
    }
    if (dropdown && dropdown.classList.contains('show')) {
      if (userBtn && !userBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      navLinks = document.getElementById('navLinks');
      hamburger = document.getElementById('navToggleBtn') || document.querySelector('.hamburger, .nav-toggle');
      if (navLinks && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        if (hamburger) {
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          hamburger.focus();
        }
      }
      var dropdown = document.getElementById('userDropdown');
      if (dropdown && dropdown.classList.contains('show')) {
        dropdown.classList.remove('show');
      }
      var aiChatWindow = document.getElementById('aiChatWindow');
      if (aiChatWindow && aiChatWindow.classList.contains('open') && typeof window.toggleAIChat === 'function') {
        window.toggleAIChat();
      }
    }
  });
  document.querySelectorAll('.alert').forEach(function (alert) {
    setTimeout(function () {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      alert.style.transition = 'all 0.5s ease';
      setTimeout(function () {
        alert.remove();
      }, 500);
    }, 5000);
  });
  function showToast(msg, type) {
    var toastType = type || 'success';
    var toast = document.createElement('div');
    toast.innerHTML = msg;
    toast.style.cssText = 'position: fixed; bottom: 5rem; right: 2rem; z-index: 99999; ' +
      'background: ' + (toastType === 'success' ? 'linear-gradient(135deg, #e8732a, #ff9554)' : '#ff4444') + '; ' +
      'color: #fff; font-family: system-ui, -apple-system, sans-serif; font-weight: 700; ' +
      'padding: 0.85rem 1.5rem; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); ' +
      'font-size: 0.95rem; max-width: 320px; transition: opacity 0.3s ease;';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 3000);
  }
  window.showToast = showToast;
  function copyOrderId(orderId) {
    navigator.clipboard.writeText(orderId).then(function () {
      showToast('Order ID disalin!');
    });
  }
  window.copyOrderId = copyOrderId;
  var timerEl = document.getElementById('paymentTimer');
  if (timerEl) {
    var seconds = 15 * 60;
    var interval = setInterval(function () {
      seconds--;
      var m = Math.floor(seconds / 60).toString().padStart(2, '0');
      var s = (seconds % 60).toString().padStart(2, '0');
      timerEl.textContent = m + ':' + s;
      if (seconds <= 0) {
        clearInterval(interval);
        timerEl.textContent = 'EXPIRED';
        timerEl.style.color = '#ff4444';
      }
    }, 1000);
  }
  function setViewMode(mode) {
    var display = document.getElementById('gamesDisplay');
    if (!display) return;
    display.classList.remove('list-view', 'compact-view', 'grid-view');
    if (mode === 'list') {
      display.classList.add('list-view');
    } else if (mode === 'compact') {
      display.classList.add('compact-view');
    } else {
      display.classList.add('grid-view');
    }
    document.querySelectorAll('.view-mode-btn').forEach(function (btn) {
      btn.classList.remove('active');
    });
    var activeBtn = document.getElementById('btn-' + mode);
    if (activeBtn) activeBtn.classList.add('active');
    localStorage.setItem('alexcloud_view_mode', mode);
  }
  window.setViewMode = setViewMode;
  var searchTimeout;
  var navSearchInput = document.getElementById('navSearchInput');
  var searchDropdown = document.getElementById('searchDropdown');
  if (navSearchInput && searchDropdown) {
    navSearchInput.addEventListener('input', function (e) {
      clearTimeout(searchTimeout);
      var q = e.target.value.trim();
      if (!q) {
        searchDropdown.classList.remove('show');
        searchDropdown.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(function () {
        fetch('/api/games/search?q=' + encodeURIComponent(q))
          .then(function (res) { return res.json(); })
          .then(function (games) {
            if (games.length === 0) {
              searchDropdown.classList.remove('show');
              return;
            }
            searchDropdown.innerHTML = games.map(function (g) {
              return '<a href="/games?q=' + encodeURIComponent(g.name) + '" class="search-result-item">' +
                '<img src="' + g.image + '" alt="' + g.name + '" loading="lazy">' +
                '<div class="search-result-info">' +
                '<div class="search-result-name">' + g.name + '</div>' +
                '<div class="search-result-genre">' + g.genre + ' · ⭐ ' + g.rating + '</div>' +
                '</div>' +
                '</a>';
            }).join('');
            searchDropdown.classList.add('show');
          })
          .catch(function () {});
      }, 300);
    });
    navSearchInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        window.location.href = '/games?q=' + encodeURIComponent(navSearchInput.value.trim());
      }
    });
    document.addEventListener('click', function (e) {
      if (searchDropdown && !searchDropdown.contains(e.target) && e.target !== navSearchInput) {
        searchDropdown.classList.remove('show');
      }
    });
  }
  var faqQuestions = document.querySelectorAll('.faq-question');
  faqQuestions.forEach(function (q) {
    q.addEventListener('click', function () {
      var item = q.parentElement;
      var activeItem = document.querySelector('.faq-item.active');
      if (activeItem && activeItem !== item) {
        activeItem.classList.remove('active');
        activeItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      }
      var isNowActive = item.classList.toggle('active');
      q.setAttribute('aria-expanded', String(isNowActive));
    });
  });
  var currentTesti = 0;
  var testiAutoPlay;
  function goToTesti(idx) {
    var cards = document.querySelectorAll('.testi-card');
    var dots = document.querySelectorAll('.testi-dot');
    if (!cards.length) return;
    cards[currentTesti].classList.remove('active');
    if (dots[currentTesti]) dots[currentTesti].classList.remove('active');
    currentTesti = (idx + cards.length) % cards.length;
    cards[currentTesti].classList.add('active');
    if (dots[currentTesti]) dots[currentTesti].classList.add('active');
  }
  window.goToTesti = goToTesti;
  function testiNext() {
    goToTesti(currentTesti + 1);
    resetTestiAutoPlay();
  }
  window.testiNext = testiNext;
  function testiPrev() {
    goToTesti(currentTesti - 1);
    resetTestiAutoPlay();
  }
  window.testiPrev = testiPrev;
  function startTestiAutoPlay() {
    testiAutoPlay = setInterval(function () {
      goToTesti(currentTesti + 1);
    }, 5000);
  }
  function resetTestiAutoPlay() {
    clearInterval(testiAutoPlay);
    startTestiAutoPlay();
  }
  if (document.querySelectorAll('.testi-card').length > 1) {
    startTestiAutoPlay();
  }
  if (window.innerWidth > 768) {
    document.querySelectorAll('.feature-card, .game-card, .plan-card, .trending-card').forEach(function (card) {
      var rect;
      card.addEventListener('mouseenter', function () {
        rect = card.getBoundingClientRect();
      });
      card.addEventListener('mousemove', function (e) {
        if (!rect) rect = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
        card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
      });
    });
  }
  function initLazyLoading() {
    var lazyImages = document.querySelectorAll('img[loading="lazy"]');
    if (!lazyImages.length) return;
    if (!('IntersectionObserver' in window)) {
      lazyImages.forEach(function (img) {
        if (img.dataset.src) img.src = img.dataset.src;
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
  function initBackToTop() {
    backToTopBtn = document.getElementById('backToTop');
    if (!backToTopBtn) return;
    backToTopBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  function handleBackToTopVisibility() {
    if (!backToTopBtn) return;
    if (window.scrollY > 400) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
  }
  function initScrollAnimations() {
    var animatedEls = document.querySelectorAll('.animate-on-scroll, [data-animate]');
    if (!animatedEls.length) return;
    if (window.innerWidth <= 768) {
      animatedEls.forEach(function (el) {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = 'none';
      });
      return;
    }
    if (!('IntersectionObserver' in window)) {
      animatedEls.forEach(function (el) {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var delay = parseInt(el.getAttribute('data-delay')) || 0;
          setTimeout(function () {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
            el.style.filter = 'blur(0px)';
          }, delay);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
    animatedEls.forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(32px)';
      el.style.filter = 'blur(4px)';
      el.style.transition = 'opacity 0.75s cubic-bezier(0.16, 1, 0.3, 1), transform 0.75s cubic-bezier(0.16, 1, 0.3, 1), filter 0.75s cubic-bezier(0.16, 1, 0.3, 1)';
      observer.observe(el);
    });
  }
  var scrollTicking = false;
  function onScroll() {
    if (!scrollTicking) {
      window.requestAnimationFrame(function () {
        handleStickyNavbar();
        handleBackToTopVisibility();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }
  function init() {
    var savedMode = localStorage.getItem('alexcloud_view_mode');
    if (savedMode && savedMode !== 'grid') {
      setViewMode(savedMode);
    }
    navbar = document.getElementById('navbar') || document.querySelector('.navbar');
    backToTopBtn = document.getElementById('backToTop');
    window.addEventListener('scroll', onScroll, { passive: true });
    initLazyLoading();
    initBackToTop();
    initScrollAnimations();
    initHeroStatsObserver();
    initHeroParticles();
    onScroll();
  }
  function animateCounters() {
    var counters = document.querySelectorAll('[data-count]');
    counters.forEach(function(counter) {
      var target = parseInt(counter.getAttribute('data-count'), 10);
      if (isNaN(target) || counter.dataset.counted) return;
      counter.dataset.counted = 'true';
      var current = 0;
      var increment = Math.max(1, Math.ceil(target / 60));
      var timer = setInterval(function() {
        current += increment;
        if (current >= target) {
          counter.textContent = target + '+';
          clearInterval(timer);
        } else {
          counter.textContent = current + '+';
        }
      }, 30);
    });
  }
  function initHeroStatsObserver() {
    if ('IntersectionObserver' in window) {
      var statsObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            animateCounters();
            statsObserver.disconnect();
          }
        });
      }, { threshold: 0.3 });
      var heroStats = document.querySelector('.hero-stats');
      if (heroStats) statsObserver.observe(heroStats);
    } else {
      animateCounters();
    }
  }
  function initHeroParticles() {
    var container = document.querySelector('.hero-particles');
    if (!container) return;
    if (window.innerWidth <= 768) return;
    for (var i = 0; i < 20; i++) {
      var dot = document.createElement('div');
      dot.className = 'hero-particle';
      dot.style.cssText = 'left:' + Math.random()*100 + '%;top:' + Math.random()*100 + '%;animation-delay:' + (Math.random()*8) + 's;animation-duration:' + (6+Math.random()*8) + 's;width:' + (2+Math.random()*3) + 'px;height:' + (2+Math.random()*3) + 'px;opacity:' + (0.15+Math.random()*0.35);
      container.appendChild(dot);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();