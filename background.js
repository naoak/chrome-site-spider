/**
 * Copyright 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * How long to wait before one gives up on a connection.
 * @type {number}
 */
var HTTP_REQUEST_TIMEOUT = 30 * 1000;
/**
 * Title of the results page (while spidering).
 * @type {string}
 */
var RESULTS_TITLE = 'Site Spider Results';
/**
 * List of mime types that we will load for further spidering.
 * text/plain is due to some web servers sending html using the wrong mime type.
 * @type {Array.<string>}
 */
var SPIDER_MIME = ['text/html', 'text/plain', 'text/xml'];

var popupDoc = null;
var allowedText = '';
var allowedRegex = null;
var allowPlusOne = false;
var allowArguments = false;
var checkInline = false;
var pagesTodo = {};
var pagesDone = {};
var spiderTab = null;
var resultsTab = null;
var httpRequest = null;
var httpRequestWatchDogPid = 0;
var newTabWatchDogPid = 0;

/**
 * Save a reference to the popup's document object,
 * then initialize the popup's fields.
 * Called by the popup as soon as it is loaded.
 * @param {Document} doc The popup's document object.
 */
function popupLoaded(doc) {
  popupDoc = doc;
  chrome.tabs.getSelected(null, setDefaultUrl_);
}

/**
 * Initialize the popup's fields.
 * Callback from chrome.tabs.getSelected.
 * @param {Tab} The currently selected tab.
 * @private
 */
function setDefaultUrl_(tab) {
  // Use the currently selected tab's URL as a start point.
  var url;
  if (tab && tab.url && tab.url.match(/^\s*https?:\/\//i)) {
    url = tab.url;
  } else {
    url = 'http://www.example.com/';
  }
  popupDoc.getElementById('start').value = url;

  // Compute a default regex which will limit the spider
  // to the current directory.
  allowedText = url;
  // Trim off any hash.
  allowedText = trimAfter(allowedText, '#');
  // Trim off any arguments.
  allowedText = trimAfter(allowedText, '?');
  // Trim off any filename, leaving the path.
  var div = allowedText.lastIndexOf('/');
  if (div > 'https://'.length) {
    allowedText = allowedText.substring(0, div + 1);
  }
  // Sanitize regex characters in URL.
  allowedText =
      allowedText.replace(/([\^\$\.\*\+\?\=\!\:\|\\\(\)\[\]\{\}])/g,
      '\\$1');
  allowedText = '^' + allowedText;
  popupDoc.getElementById('regex').value = allowedText;

  // Restore previous setting for checkboxes.
  popupDoc.getElementById('plusone').checked = allowPlusOne;
  popupDoc.getElementById('arguments').checked = !allowArguments;
  popupDoc.getElementById('inline').checked = checkInline;
}

/**
 * Truncate a string to remove the specified character and anything after.
 * e.g. trimAfter('ab-cd-ef', '-') -> 'ab'
 * @param {string} string String to trim.
 * @param {string} sep Character to split on.
 * @return {string} String with character and any trailing substring removed.
 */
function trimAfter(string, sep) {
  var div = string.indexOf(sep);
  if (div != -1) {
    return string.substring(0, div);
  }
  return string;
}

/**
 * Start a spidering session.
 * Called by the popup's Go button.
 */
function popupGo() {
  // Terminate any previous execution.
  popupStop();

  // This plugin gets very unhappy when there are multiple concurrent results.
  // Rename title of any previous results so we don't edit them.
  var resultsWindows = chrome.extension.getViews({type: 'tab'});
  for (var x = 0; x < resultsWindows.length; x++) {
    var doc = resultsWindows[x].document;
    if (doc.title == RESULTS_TITLE) {
      doc.title = RESULTS_TITLE + ' - Closed';
    }
  }

  // Attempt to parse the allowed URL regex.
  var input = popupDoc.getElementById('regex');
  allowedText = input.value;
  try {
    allowedRegex = new RegExp(allowedText);
  } catch (e) {
    alert('Restrict regex error:\n' + e);
    popupStop();
    return;
  }

  // Save settings for checkboxes.
  allowPlusOne = popupDoc.getElementById('plusone').checked;
  allowArguments = !popupDoc.getElementById('arguments').checked;
  checkInline = popupDoc.getElementById('inline').checked;

  // Initialize the todo and done lists.
  pagesTodo = {};
  pagesDone = {};
  // Add the start page to the todo list.
  var startPage = popupDoc.getElementById('start').value;
  pagesTodo[startPage] = '[root page]';

  /**
   * Record a reference to the results tab so that output may be
   * written there during spidering.
   * @param {Tab} The new tab.
   * @private
   */
  function resultsLoadCallback_(tab) {
    resultsTab = tab;

    var resultsDoc = getResultsDoc();
    setInnerSafely(resultsDoc, 'startingOn', startPage);
    setInnerSafely(resultsDoc, 'restrictTo', allowedText);

    // Start spidering.
    spiderPage();
  }

  // Open a tab for the results.
  chrome.tabs.create({url: 'results.html'}, resultsLoadCallback_);
}


/**
 * Set the innerHTML of a named element with a message.  Escape the message.
 * @param {Document} doc Document containing the element.
 * @param {string} id ID of element to change.
 * @param {*} msg Message to set.
 */
function setInnerSafely(doc, id, msg) {
  if (doc) {
    var el = doc.getElementById(id);
    if (el) {
      msg = msg.toString();
      msg = msg.replace(/&/g, '&amp;');
      msg = msg.replace(/</g, '&lt;');
      msg = msg.replace(/>/g, '&gt;');
      el.innerHTML = msg;
    }
  }
}

/**
 * Cleanup after a spidering session.
 */
function popupStop() {
  pagesTodo = {};
  spiderTab = null;
  resultsTab = null;
  window.clearTimeout(httpRequestWatchDogPid);
  window.clearTimeout(newTabWatchDogPid);
  // Reenable the Go button.
  popupDoc.getElementById('go').disabled = false;
}

/**
 * Start spidering one page.
 */
function spiderPage() {
  setStatus('Next page...');
  if (!resultsTab) {
    // Results tab was closed.
    return;
  }

  // Pull one page URL out of the todo list.
  var url = null;
  for (url in pagesTodo) {
    break;
  }
  if (!url) {
    // Done.
    setStatus('Complete');
    popupStop();
    return;
  }
  var referrer = pagesTodo[url];
  delete pagesTodo[url];
  pagesDone[url] = true;

  // Fetch this page using Ajax.
  setStatus('Prefetching ' + url);
  httpRequestWatchDogPid = window.setTimeout(httpRequestWatchDog,
                                             HTTP_REQUEST_TIMEOUT);
  httpRequest = new XMLHttpRequest();
  httpRequest.onreadystatechange = httpRequestChange;
  httpRequest.open('HEAD', url, false);
  httpRequest.url = url; // Create new 'url' property.
  httpRequest.referrer = referrer; // Create new 'referrer' property.
  // For some reason this request only works intermitently when called directly.
  // Delay request by 1ms.
  window.setTimeout('httpRequest.send(null)', 1);
}

/**
 * Terminate an http request that hangs.
 */
function httpRequestWatchDog() {
  setStatus('Aborting HTTP Request');
  if (httpRequest) {
    httpRequest.abort();
    // Record page details.
    recordPage(httpRequest.url, null, '[???]', httpRequest.referrer);
    httpRequest = null;
  }
  window.setTimeout(spiderPage, 1);
}

/**
 * Terminate a new tab that hangs (happens when a binary file downloads).
 */
function newTabWatchDog() {
  setStatus('Aborting New Tab');
  if (spiderTab) {
    chrome.tabs.remove(spiderTab.id);
    spiderTab = null;
    // This page will already have been logged, all we are missing is futher
    // spidering opportunities.
  }
  window.setTimeout(spiderPage, 1);
}

/**
 * Callback for when the status of the Ajax fetch changes.
 */
function httpRequestChange() {
  if (!httpRequest || httpRequest.readyState < 2) {
    // Still loading.  Wait for it.
    return;
  }
  var code = httpRequest.status;
  var mime = httpRequest.getResponseHeader('Content-Type') || '[none]';
  var url = httpRequest.url;
  var referrer = httpRequest.referrer;
  httpRequest = null;
  window.clearTimeout(httpRequestWatchDogPid);
  setStatus('Prefetched ' + url + ' (' + code + ' ' + mime + ')');

  // Record page details.
  recordPage(url, code, mime, referrer);

  // 'SPIDER_MIME' is a list of allowed mime types.
  // 'mime' could be in the form of "text/html; charset=utf-8"
  // For each allowed mime type, check for its presence in 'mime'.
  var mimeOk = false;
  for (var x = 0; x < SPIDER_MIME.length; x++) {
    if (mime.indexOf(SPIDER_MIME[x]) != -1) {
      mimeOk = true;
      break;
    }
  }

  // If this is a redirect or an HTML page, open it in a new tab and
  // look for links to follow.  Otherwise, move on to next page.
  if (url.match(allowedRegex) &&
      ((code >= 300 && code < 400) || (code < 300 && mimeOk))) {
    setStatus('Fetching ' + url);
    newTabWatchDogPid = window.setTimeout(newTabWatchDog,
                                          HTTP_REQUEST_TIMEOUT);
    chrome.tabs.create({url: url, selected: false}, spiderLoadCallback_);
  } else {
    setStatus('Queueing page [1]...');
    window.setTimeout(spiderPage, 1);
  }
}

/**
 * Inject the spider code into the newly opened page.
 * @param {Tab} The new tab.
 * @private
 */
function spiderLoadCallback_(tab) {
  spiderTab = tab;
  setStatus('Spidering ' + spiderTab.url);
  chrome.tabs.executeScript(tab.id, {file: 'spider.js'});
}

// Add listener for message events from the injected spider code.
chrome.extension.onRequest.addListener(
    function(request, sender, sendResponse) {
      if ('links' in request) {
        spiderInjectCallback(request.links, request.inline);
      }
    });

/**
 * Process the data returned by the injected spider code.
 * @param {Array} links List of links away from this page.
 * @param {Array} inline List of inline resources in this page.
 */
function spiderInjectCallback(links, inline) {
  var url = spiderTab.url;
  setStatus('Scanning ' + url);
  if (checkInline) {
    links = links.concat(inline);
  }
  // Add any new links to the Todo list.
  for (var x = 0; x < links.length; x++) {
    var link = links[x];
    link = trimAfter(link, '#');  // Trim off any hash.
    if (link && !(link in pagesDone) && !(link in pagesTodo)) {
      if (allowArguments || link.indexOf('?') == -1) {
        if (link.match(allowedRegex) ||
            (allowPlusOne && url.match(allowedRegex))) {
          pagesTodo[link] = url;
        }
      }
    }
  }

  // Close this page and mark done.
  // In the case of a redirect this URL might be different than the one we
  // marked spidered above.  Mark this one as spidered too.
  pagesDone[url] = true;
  chrome.tabs.remove(spiderTab.id);
  spiderTab = null;
  window.clearTimeout(newTabWatchDogPid);
  setStatus('Queueing page [2]...');

  // Move on to the next page.
  window.setTimeout(spiderPage, 1);
}

/**
 * Record the details of one url to the results tab.
 * @param {string} url URL of page.
 * @param {number} code HTTP status code of page.
 * @param {string} mime MIME type of page.
 */
function recordPage(url, code, mime, referrer) {
  url = '<a href="' + url + '" target="spiderpage" title="' + url + '">' +
        url + '</a>';

  // Mime often includes chartype:  text/html; charset=utf-8
  var semicolon = mime.indexOf(';');
  if (semicolon != -1) {
    mime = mime.substring(0, semicolon);
  }

  var codeclass = '';
  if (code) {
    codeclass = 'x' + Math.floor(code / 100);
    if (code in rfc2616) {
      code += ' ' + rfc2616[code];
    }
  } else {
    codeclass = 'x0';
    code = 'Unable to load';
  }

  var resultsDoc = getResultsDoc();
  if (resultsDoc) {
    var tbody = resultsDoc.getElementById('resultbody');
    var tr = resultsDoc.createElement('tr');
    tr.innerHTML += '<td>' + url + '</td>' +
                    '<td class="' + codeclass + '">' + code + '</td>' +
                    '<td>' + mime + '</td>' +
                    '<td><span title="' + referrer + '">' + referrer + '</span></td>';
    tbody.appendChild(tr);
  }
}

// HTTP Status Code Definitions.
// http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
var rfc2616 = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  306: '(Unused)',
  307: 'Temporary Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Requested Range Not Satisfiable',
  417: 'Expectation Failed',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported'
};

/**
 * Set the current status message to the results tab.
 * Also print count of number of items left in queue.
 * @param {string} msg Status message.
 */
function setStatus(msg) {
  var resultsDoc = getResultsDoc();
  setInnerSafely(resultsDoc, 'queue', Object.keys(pagesTodo).length);
  setInnerSafely(resultsDoc, 'status', msg);
}

/**
 * Get the document object of the results page.
 * @return {Document} Result page's document object.
 */
function getResultsDoc() {
  var resultsWindows = chrome.extension.getViews({type: 'tab'});
  for (var x = 0; x < resultsWindows.length; x++) {
    var doc = resultsWindows[x].document;
    if (doc.title == RESULTS_TITLE) {
      return doc;
    }
  }
  // Someone closed the results?
  popupStop();
  return null;
}
