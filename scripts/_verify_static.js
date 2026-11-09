// 验证布局是否真的静止：在不同时间点采样节点坐标，比较是否一致
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = 'C:\\Users\\yzk\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const SRC = path.join(__dirname, '../src');

const probe = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Stability</title></head>
<body style="margin:0;background:#05080f">
<canvas id="graphCanvas" style="width:1200px;height:700px;display:block"></canvas>
<pre id="out" style="color:#0f0;font:12px monospace;padding:8px;white-space:pre"></pre>
<script src="data/graph-data.js"></script>
<script src="js/barnes-hut.js"></script>
<script src="js/graph.js"></script>
<script>
var log = [];
function say(s){ log.push(s); document.getElementById('out').textContent = log.join('\\n'); }
try {
  var g = new KnowledgeGraph(document.getElementById('graphCanvas'), GRAPH_DATA, {onSelect:function(){}});
  window.__g = g;

  function snapshot(){
    // 取前 30 个可见节点的坐标做指纹
    var vis = g.nodes.filter(function(n){ return n.visible; }).slice(0, 30);
    return vis.map(function(n){ return n.x.toFixed(3) + ',' + n.y.toFixed(3); }).join(';');
  }

  // 等布局预热完成（最多 12 秒）
  var waited = 0;
  var timer = setInterval(function(){
    waited += 200;
    if (g._layoutFrozen || waited > 12000) {
      clearInterval(timer);
      var s1 = snapshot();
      say('布局冻结: ' + (g._layoutFrozen ? '是' : '否(超时)'));
      say('预热等待: ' + waited + 'ms');
      say('alpha: ' + g.alpha);

      // 1 秒后再采样，检查是否移动
      setTimeout(function(){
        var s2 = snapshot();
        say('');
        say('=== 稳定性检查 ===');
        say('1秒后坐标一致: ' + (s1 === s2 ? '✅ 完全静止' : '❌ 仍在移动'));
        if (s1 !== s2) {
          var a1 = s1.split(';'), a2 = s2.split(';');
          var diff = 0;
          for (var i=0;i<a1.length;i++) if (a1[i] !== a2[i]) diff++;
          say('  变化的节点数: ' + diff + '/' + a1.length);
        }

        // 再等 2 秒复查
        setTimeout(function(){
          var s3 = snapshot();
          say('3秒后坐标一致: ' + (s1 === s3 ? '✅ 仍然静止' : '❌ 又有变化'));
          say('');
          say('可见节点: ' + g.getVisibleCount() + ' / ' + g.nodes.length);
          say('view.scale: ' + g.view.scale.toFixed(3));
          document.title = 'DONE';
        }, 2000);
      }, 1000);
    }
  }, 200);
} catch(e) {
  say('ERR: ' + e.message);
  document.title = 'DONE';
}
</script></body></html>`;

fs.writeFileSync(path.join(SRC, '_stability.html'), probe, 'utf8');

const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--window-size=1280,900',
  '--virtual-time-budget=20000',
  '--dump-dom',
  'http://127.0.0.1:8899/_stability.html'
];

try {
  const out = execFileSync(CHROME, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 10 * 1024 * 1024 });
  const m = out.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
  if (m) {
    console.log('=== 静态布局验证 ===');
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('\n').forEach(l => console.log('  ' + l.trim()));
  } else {
    console.log('未获取到输出');
    console.log(out.slice(0, 400));
  }
} catch (e) {
  console.log('执行失败:', e.message);
}
