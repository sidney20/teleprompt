var parser = require('./parser.js');
var fs = require('fs');

var text = fs.readFileSync('test_doc.txt', 'utf8');
var scripts = parser.parseScripts(text);

console.log('Total scripts found:', scripts.length);
console.log('');
var nums = [];
scripts.forEach(function(s) {
  nums.push(s.num);
  console.log('Script', s.num, '-', s.displayTitle.slice(0,70), '- words:', s.words);
});

console.log('');
console.log('Numbers found:', nums.join(','));

var gaps = [];
for (var i = 1; i <= Math.max.apply(null, nums); i++) {
  if (nums.indexOf(i) === -1) gaps.push(i);
}
if (gaps.length > 0) {
  console.log('[IMPORT WARNING] Missing scripts:', gaps.join(','));
} else {
  console.log('[IMPORT OK] No gaps detected');
}
