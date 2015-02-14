'use strict';

var url = require('url');
var querystring = require('querystring');
var ytdl = require('ytdl-core');

function readRangeHeader(range, totalLength) {
  if (!range) { return; }
  var positions = range.replace('bytes=', '').split('-');

  var start = parseInt(positions[0], 10);
  var end = parseInt(positions[1], 10);

  var result = {
    start: isNaN(start) ? 0 : start,
    end: isNaN(end) ? (totalLength - 1) : end
  };

  if (!isNaN(start) && isNaN(end)) {
    result.start = start;
    result.end = totalLength - 1;
  }

  if (isNaN(start) && !isNaN(end)) {
    result.start = totalLength - end;
    result.end = totalLength - 1;
  }

  return result;
}

var videoSizes = {};

function server(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(501);
    res.end();
    return;
  }
  var query = querystring.parse(url.parse(req.url).query);
  var videoId = query.v;
  var itag = +query.itag || 43;
  if (videoId) {
    ytdl.getInfo('http://youtu.be/' + videoId, {}, function (err, info) {
      if (err) {
        res.writeHead(404);
        res.end('Seems the link you\'ve given is broken');
        return;
      }
      res.writeHead(302, { 'Location': '/pr/' + info.title.replace(/ /g, '_') + ' ' + videoId + '.webm' });
      res.end();
    });
    return;
  }

  videoId = (/([a-zA-Z0-9_-]{11})\.(webm|mp4)($|\?)/.exec(req.url) || {})[1];
  if (!videoId) {
    res.writeHead(404);
    res.end('Sorry, nothing really interesting is here');
    return;
  }

  ytdl.getInfo('http://youtu.be/' + videoId, {}, function (err, info) {
    if (err) {
      res.writeHead(404);
      res.end('Seems the link you\'ve given is broken');
      return;
    }
    if (req.url.endsWith('?info')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(JSON.stringify(info, 2, 2));
      return;
    }
    if (req.url.endsWith('?list')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<form method="GET"><select name="itag">' + info.formats.map(function (x) {
        return `<option value="${x.itag}">${x.container} ${x.quality || x.size || 'audio'}</option>`;
      }).join('\n') + '</select><input type="submit"></form>');
      return;
    }
    var sizePromise;
    if (!videoSizes[videoId + itag]) {
      sizePromise = new Promise(function (resolve, reject) {
        ytdl.downloadFromInfo(info, { quality: itag }).on('format', function (format) {
          if (format instanceof Error) {
            reject(error);
          } else {
            videoSizes[videoId + itag] = format.size;
            resolve(format.size);
          }
        }).on('error', function () { reject('Not downloadable'); });
      });
    } else {
      sizePromise = Promise.resolve(videoSizes[videoId + itag]);
    }

    sizePromise.then(function (size) {
      var options = { quality: itag };
      var range = readRangeHeader(req.headers.range, size);

      if (range) {
        // If the range can't be fulfilled.
        if (range.start >= size || range.end >= size) {
          // 416: 'Requested Range Not Satisfiable'
          res.writeHead(416, {
            'Content-Range': 'bytes */' + stat.size
          });
          res.end('Requested Range Not Satisfiable');
          return;
        }

        options.range = range.start + '-' + range.end;
      }

      ytdl.downloadFromInfo(info, options).on('format', function (format) {
        if (format instanceof Error) {
          res.writeHead(404);
        } else if (!range) {
          res.writeHead(200, {
            'Content-Length': format.size,
            'Content-Type': format.type,
            'Accept-Ranges': 'bytes'
          });
        } else {
          res.writeHead(206, {
            'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + size,
            'Content-Length': range.start === range.end ? 0 : (range.end - range.start + 1),
            'Content-Type': format.type,
            'Accept-Ranges': 'bytes'
          });
        }
      }).on('error', function (e) {
        res.end((e || '').toString());
      }).pipe(res);
    }).then(undefined, function (error) {
      res.writeHead(404);
      res.end('Internal error: ' + error);
    });
  });
}

if (process.env.FCGI_MODE) { // called through fcgi
  require('node-fastcgi').createServer(server).listen();
} else { // called directly, development
  var port = process.argv[2] || 19876;
  require('http').createServer(server).listen(port, '0.0.0.0');
  console.log('Server running at http://0.0.0.0:' + port + '/');
}

