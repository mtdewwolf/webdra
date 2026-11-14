(function frameBuster() {
  if (window.top === window.self) return;
  try {
    if (window.top) window.top.location.replace(window.location.href);
  } catch (error) {
    var root = document.documentElement;
    while (root.firstChild) root.removeChild(root.firstChild);
    var body = document.createElement('body');
    var message = document.createElement('p');
    message.textContent = 'Webdra refuses to run inside a frame.';
    body.appendChild(message);
    root.appendChild(body);
  }
})();
