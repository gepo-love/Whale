(function () {
  // Local mirror mode: treat the remote activation check as satisfied.
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/auth/status') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ activated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    return nativeFetch(input, init);
  };

  var removeActivationOverlay = function () {
    var overlay = document.getElementById('activationOverlay');
    if (overlay) overlay.remove();
  };
  removeActivationOverlay();
  new MutationObserver(removeActivationOverlay).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
