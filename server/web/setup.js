/* Setup page extras. The page works without this file; it only adds: keeping the page up to date,
   the Copy button and CSV import. Written in plain old JavaScript so it runs in any browser. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tokenInput = document.querySelector('input[name="t"]');
  var token = tokenInput ? tokenInput.value : '';

  // Show the latest pairing code / paired PCs: reload every 10 seconds unless someone is typing.
  // (?auto=1: a refresh never opens a new pairing code - only a person opening the page or clicking New code does.)
  setInterval(function () {
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    location.replace('/setup?auto=1');
  }, 10000);

  // Copy the TV address
  var copy = $('copyTv');
  if (copy && navigator.clipboard) {
    copy.hidden = false;
    copy.onclick = function () {
      navigator.clipboard.writeText($('tvUrl').textContent).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      });
    };
  }

  // Import a CSV (needs a browser that can read files)
  var file = $('importFile');
  if (file && window.FileReader && window.XMLHttpRequest) {
    $('importRow').hidden = false;
    file.onchange = function () {
      var f = file.files[0];
      file.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var x = new XMLHttpRequest();
        x.open('POST', '/api/setup/import');
        x.setRequestHeader('X-Setup', token);
        x.setRequestHeader('Content-Type', 'text/csv');
        x.onload = function () {
          var r = {};
          try { r = JSON.parse(x.responseText); } catch (e) { r = { error: 'Import failed.' }; }
          $('importMsg').textContent = r.error ? r.error : 'Imported: ' + r.added + ' added, ' + r.updated + ' updated.';
        };
        x.send(reader.result);
      };
      reader.readAsText(f);
    };
  }
}());
