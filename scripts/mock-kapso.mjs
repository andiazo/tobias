import http from 'node:http';
const enviados = [];
http.createServer((req, res) => {
  if (req.url === '/__enviados') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify(enviados, null, 1));
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { enviados.push({ url: req.url, payload: JSON.parse(body || '{}') }); }
    catch { enviados.push({ url: req.url, raw: body }); }
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.mock.' + enviados.length }] }));
  });
}).listen(8788, () => console.log('mock kapso en 8788'));
