/*
Table Sorter v2.3
Adds bi-directional sorting to table columns.
Copyright 2005 Digital Routes, Scotland
Copyright 2007 Neil Fraser, California
Copyright 2011 Google Inc.
http://neil.fraser.name/software/tablesort/

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Include on your page:
  <SCRIPT LANGUAGE='JavaScript1.2' SRC='tablesort.js'></SCRIPT>
*/

// Namespace object.
var TableSort = {};

// Switch to enable or disable the TableSort.
TableSort.enabled = true;

// Default text values for the arrows.  Override these with custom image tags.
TableSort.arrowNone = ' <img height=10 width=10 src="blank.gif" alt="">';
TableSort.arrowUp   = ' <img height=10 width=10 src="arrow-up.gif" alt="&uarr;">';
TableSort.arrowDown = ' <img height=10 width=10 src="arrow-down.gif" alt="&darr;">';

// Tooltip to display when mousing over a sorting link.
TableSort.titleText = 'Sort by this column';

/**
 * List of all the tables.
 * @private
 */
TableSort.tables = [];

/**
 * Upon which column was the table sorted last time.  -=up, +=down
 * @private
 */
TableSort.lastSort = [];


/**
 * Make all tables sortable.
 */
TableSort.initAll = function() {
  if (!TableSort.enabled) {
    return;
  }
  var tableNodeList = document.getElementsByTagName('TABLE');
  for (var x = 0, table; table = tableNodeList[x]; x++) {
    TableSort.initTable_(table);
  }
};


/**
 * Make one or more tables sortable.
 * Call this function with the ID(s) of any tables which are created
 * with DTHML after the page has loaded.
 * @param {...string} var_args ID(s) of tables.
 */
TableSort.init = function(var_args) {
  if (!TableSort.enabled) {
    return;
  }
  for (var x = 0; x < arguments.length; x++) {
    var table = document.getElementById(arguments[x]);
    if (table) {
      TableSort.initTable_(table);
    }
  }
};


/**
 * Turn all the header/footer cells of one table into sorting links.
 * @param {Element} table The table to be converted.
 * @private
 */
TableSort.initTable_ = function(table) {
  TableSort.tables.push(table);
  var t = TableSort.tables.length - 1;
  if (table.tHead) {
    for (var y = 0, row; row = table.tHead.rows[y]; y++) {
      for (var x = 0, cell; cell = row.cells[x]; x++) {
        TableSort.linkCell_(cell, t, x);
      }
    }
  }
  if (table.tFoot) {
    for (var y = 0, row; row = table.tFoot.rows[y]; y++) {
      for (var x = 0, cell; cell = row.cells[x]; x++) {
        TableSort.linkCell_(cell, t, x);
      }
    }
  }
  TableSort.lastSort[t] = 0;
};


/**
 * Turn one header/footer cell into a sorting link.
 * @param {!Element} cell The TH or TD to be made a link.
 * @param {number} t Index of table in TableSort array.
 * @param {number} x Column index.
 * @private
 */
TableSort.linkCell_ = function(cell, t, x) {
  if (TableSort.getClass_(cell)) {
    var link = document.createElement('A');
    link.href = 'javascript:TableSort.click(' + t + ', ' + x + ', "' +
        escape(TableSort.getClass_(cell)) + '");';
    if (TableSort.titleText) {
      link.title = TableSort.titleText;
    }
    while(cell.hasChildNodes()) {
      link.appendChild(cell.firstChild);
    }
    cell.appendChild(link);
    // Add an element where the sorting arrows will go.
    var arrow = document.createElement('SPAN');
    arrow.innerHTML = TableSort.arrowNone;
    arrow.className = 'TableSort_' + t + '_' + x;
    cell.appendChild(arrow);
  }
};


/**
 * Return the class name for a cell.  The name must match a sorting function.
 * @param {!Element} cell The cell element.
 * @returns {string} Class name matching a sorting function.
 * @private
 */
TableSort.getClass_ = function(cell) {
  var className = (cell.className || '').toLowerCase();
  var classList = className.split(/\s+/g);
  for (var x = 0; x < classList.length; x++) {
    if (('compare_' + classList[x]) in TableSort) {
      return classList[x];
    }
  }
  return '';
};


/**
 * Sort the rows in this table by the specified column.
 * @param {number} t Index of table in TableSort array.
 * @param {number} column Index of the column to sort by.
 * @param {string} mode Sorting mode (e.g. 'nocase').
 */
TableSort.click = function(t, column, mode) {
  var table = TableSort.tables[t];
  if (!mode.match(/^[_a-z0-9]+$/)) {
    alert('Illegal sorting mode type.');
    return;
  }
  var compareFunction = TableSort['compare_' + mode];
  if (typeof compareFunction != 'function') {
    alert('Unknown sorting mode: ' + mode);
    return;
  }
  // Determine and record the direction.
  var reverse = false;
  if (Math.abs(TableSort.lastSort[t]) == column + 1) {
    reverse = TableSort.lastSort[t] > 0;
    TableSort.lastSort[t] *= -1;
  } else {
    TableSort.lastSort[t] = column + 1;
  }
  // Display the correct arrows on every header/footer cell.
  var spanprefix1 = 'TableSort_' + t + '_';
  var spanprefix2 = 'TableSort_' + t + '_' + column;
  var spans = table.getElementsByTagName('SPAN');
  for (var s = 0, span; span = spans[s]; s++) {
    if (span.className && span.className.substring(0, spanprefix1.length) ==
        spanprefix1) {
      if (span.className.substring(0, spanprefix2.length) == spanprefix2) {
        if (reverse) {
          span.innerHTML = TableSort.arrowDown;
        } else {
          span.innerHTML = TableSort.arrowUp;
        }
      } else {
        span.innerHTML = TableSort.arrowNone;
      }
    }
  }
  // Fetch the table's data and store it in a dictionary (assoc array).
  if (!table.tBodies.length) {
    return; // No data in table.
  }
  var tablebody = table.tBodies[0];
  var cellDictionary = [];
  for (var y = 0, row; row = tablebody.rows[y]; y++) {
    var cell;
    if (row.cells.length) {
      cell = row.cells[column];
    } else { // Dodge Safari 1.0.3 bug
      cell = row.childNodes[column];
    }
    cellDictionary[y] = [TableSort.dom2txt_(cell), row];
  }
  // Sort the dictionary.
  cellDictionary.sort(compareFunction);
  // Rebuild the table with the new order.
  for (y = 0; y < cellDictionary.length; y++) {
    var i = reverse ? (cellDictionary.length - 1 - y) : y;
    tablebody.appendChild(cellDictionary[i][1]);
  }
};


/**
 * Recursively build a plain-text version of a DOM structure.
 * Bug: whitespace isn't always correct, but shouldn't matter for tablesort.
 * @param {Element} obj Element to flatten into text.
 * @returns {string} Plain-text contents of element.
 * @private
 */
TableSort.dom2txt_ = function(obj) {
  if (!obj) {
    return '';
  }
  if (obj.nodeType == 3) {
    return obj.data;
  }
  var textList = [];
  for (var x = 0, child; child = obj.childNodes[x]; x++) {
    textList[x] = TableSort.dom2txt_(child);
  }
  return textList.join('');
};


/**
 * Case-sensitive sorting.
 * Compare two dictionary structures and indicate which is larger.
 * @param {Array} a First tuple.
 * @param {Array} b Second tuple.
 */
TableSort.compare_case = function(a, b) {
  if (a[0] == b[0]) {
    return 0;
  }
  return (a[0] > b[0]) ? 1 : -1;
};

/**
 * Case-insensitive sorting.
 * Compare two dictionary structures and indicate which is larger.
 * @param {Array} a First tuple.
 * @param {Array} b Second tuple.
 */
TableSort.compare_nocase = function(a, b) {
  var aLower = a[0].toLowerCase();
  var bLower = b[0].toLowerCase();
  if (aLower == bLower) {
    return 0;
  }
  return (aLower > bLower) ? 1 : -1;
};

/**
 * Numeric sorting.
 * Compare two dictionary structures and indicate which is larger.
 * @param {Array} a First tuple.
 * @param {Array} b Second tuple.
 */
TableSort.compare_num = function(a, b) {
  var aNum = parseFloat(a[0]);
  if (isNaN(aNum)) {
    aNum = -Number.MAX_VALUE;
  }
  var bNum = parseFloat(b[0]);
  if (isNaN(bNum)) {
    bNum = -Number.MAX_VALUE;
  }
  if (aNum == bNum) {
    return 0;
  }
  return (aNum > bNum) ? 1 : -1;
};


if (window.addEventListener) {
  window.addEventListener('load', TableSort.initAll, false);
} else if (window.attachEvent) {
  window.attachEvent('onload', TableSort.initAll);
}

if (navigator.appName == 'Microsoft Internet Explorer' &&
    navigator.platform.indexOf('Mac') == 0) {
  // The Mac version of MSIE is way too buggy to deal with.
  TableSort.enabled = false;
}
