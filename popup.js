//
// On page load
//
document.addEventListener('DOMContentLoaded', function() {
  chrome.extension.getBackgroundPage().popupLoaded(document);
  document.getElementById('go').addEventListener('click', function() {
    chrome.extension.getBackgroundPage().popupGo();
    window.close();
  });
});
